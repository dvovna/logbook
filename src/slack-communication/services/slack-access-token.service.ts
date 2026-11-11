import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  IBotTokens,
  IStoredBotTokens,
  SlackTeamsService,
} from '@modules/slack-teams/slack-teams.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { TransactionService } from 'src/database/transaction.service';
import { slackTokenLock } from 'src/database/advisory-locks';

// A day. cache-manager takes milliseconds.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// A rotating token is refreshed this long before it expires.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

// After a failed refresh the old token is used this long before the next
// try, so that every call doesn't read the database and call Slack again.
export const RETRY_REFRESH_AFTER_MS = 60 * 1000;

// The bot token of a workspace for every call to Slack. A rotating token
// (token_rotation_enabled in the Slack app) expires after 12 hours: it is
// refreshed shortly before, once per workspace however many calls and
// processes wait for it, and the new pair is stored. Each process caches the
// token until it is due, which the stored expiry sets, so all of them come
// for the next one at the same moment; a token another process's reinstall
// or uninstall revoked is read again when Slack refuses it
// (SlackCommunicationService). A token from before rotation never expires.
@Injectable()
export default class AccessTokenService {
  private readonly logger = new Logger(AccessTokenService.name);

  // One load (and refresh) at a time per workspace in this process: the
  // other calls wait for it, and then find the token in the cache. Other
  // processes wait for the refresh lock instead (refresh()).
  private readonly loading = new Map<string, Promise<string>>();

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly slackApiClient: SlackApiClient,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly transactions: TransactionService,
  ) {}

  public async getAccessToken(teamId: string): Promise<string> {
    const cached = await this.cacheManager.get<string>(this.cacheKey(teamId));

    if (cached) {
      return cached;
    }

    const running = this.loading.get(teamId);

    if (running) {
      return running;
    }

    const load = this.load(teamId).finally(() => this.loading.delete(teamId));

    this.loading.set(teamId, load);

    return load;
  }

  // The token stored now, for a call Slack refused with `refused`: it is the
  // same one unless a reinstall, an uninstall or a refresh changed it.
  public async reload(teamId: string, refused: string): Promise<string> {
    await this.forgetRefused(teamId, refused);

    return this.getAccessToken(teamId);
  }

  // Drops `refused` from the cache, unless another call put a newer token
  // there already.
  public async forgetRefused(teamId: string, refused: string) {
    const cached = await this.cacheManager.get<string>(this.cacheKey(teamId));

    if (cached === refused) {
      await this.forget(teamId);
    }
  }

  // After a reinstall or an uninstall the cached token is a revoked one.
  public async forget(teamId: string) {
    await this.cacheManager.del(this.cacheKey(teamId));
  }

  private async load(teamId: string): Promise<string> {
    const tokens = await this.findTokens(teamId);

    if (!this.isDue(tokens)) {
      await this.remember(teamId, tokens, this.untilDue(tokens));

      return tokens.token;
    }

    let current: IBotTokens;

    try {
      current = await this.refresh(teamId);
    } catch (error) {
      // Refreshed early, so the old token may still be good for a while.
      if (error instanceof NotFoundException || !this.isValid(tokens)) {
        throw error;
      }

      this.logger.warn(
        `Could not refresh the bot token of ${teamId}, using it while it lasts: ${(error as Error).message}`,
      );
      await this.remember(
        teamId,
        tokens,
        Math.min(RETRY_REFRESH_AFTER_MS, this.untilExpiry(tokens)),
      );

      return tokens.token;
    }

    await this.remember(teamId, current, this.untilDue(current));

    return current.token;
  }

  // Slack takes a refresh token once: a second refresh with it fails, and
  // its pair could replace the good one. So under the workspace's lock the
  // stored pair is read again and refreshed only when no other process did
  // it meanwhile. Slack's answer is waited for in the transaction, holding a
  // connection: once per workspace in 12 hours, and within
  // TOKEN_REFRESH_CALL_OPTIONS's bound. The new pair is saved only over the
  // pair it replaces (saveRefreshedTokens): a reinstall or an uninstall that
  // came first is kept, and the call uses what is stored.
  private refresh(teamId: string): Promise<IBotTokens> {
    return this.transactions.transaction(async () => {
      await this.transactions.lock(slackTokenLock(teamId));

      const tokens = await this.findTokens(teamId);

      if (!this.isDue(tokens)) {
        return tokens;
      }

      const response = await this.slackApiClient.refreshToken({
        refreshToken: tokens.refreshToken!,
        clientId: this.config.getOrThrow<string>(
          EnvironmentVariable.SlackClientId,
        ),
        clientSecret: this.config.getOrThrow<string>(
          EnvironmentVariable.SlackClientSecret,
        ),
      });
      const refreshed: IBotTokens = {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: new Date(Date.now() + response.expires_in * 1000),
      };

      if (
        await this.slackTeamsService.saveRefreshedTokens(
          teamId,
          tokens,
          refreshed,
        )
      ) {
        return refreshed;
      }

      this.logger.warn(
        `The bot token of ${teamId} changed while it was refreshed: using the stored one`,
      );

      return this.findTokens(teamId);
    });
  }

  private async findTokens(teamId: string): Promise<IStoredBotTokens> {
    const tokens = await this.slackTeamsService.findTokens(teamId);

    if (!tokens) {
      throw new NotFoundException('Team not found');
    }

    return tokens;
  }

  private isDue(tokens: IBotTokens) {
    return (
      !!tokens.refreshToken &&
      !!tokens.expiresAt &&
      this.untilExpiry(tokens) < REFRESH_MARGIN_MS
    );
  }

  private isValid(tokens: IBotTokens) {
    return this.untilExpiry(tokens) > 0;
  }

  private untilExpiry({ expiresAt }: IBotTokens) {
    return expiresAt ? expiresAt.getTime() - Date.now() : Infinity;
  }

  // Every process caches a token until the moment it is due for a refresh,
  // which comes from the stored expiry: they all come for the next one at
  // once, and the lock lets one of them refresh it.
  private untilDue(tokens: IBotTokens) {
    return this.untilExpiry(tokens) - REFRESH_MARGIN_MS;
  }

  private async remember(teamId: string, { token }: IBotTokens, ttl: number) {
    const ttlMs = Math.min(CACHE_TTL_MS, ttl);

    if (ttlMs > 0) {
      await this.cacheManager.set(this.cacheKey(teamId), token, ttlMs);
    }
  }

  private cacheKey(teamId: string) {
    return `slack:access_token:${teamId}`;
  }
}
