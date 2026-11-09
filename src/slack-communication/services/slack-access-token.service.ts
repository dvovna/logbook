import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  IBotTokens,
  SlackTeamsService,
} from '@modules/slack-teams/slack-teams.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

// A day. cache-manager takes milliseconds.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// A rotating token is refreshed this long before it expires.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

interface IRefreshResponse {
  access_token: string;
  refresh_token: string;
  // Seconds.
  expires_in: number;
}

// The bot token of a workspace for every call to Slack. A rotating token
// (token_rotation_enabled in the Slack app) expires after 12 hours: it is
// refreshed shortly before, once per workspace however many calls wait for
// it, and the new pair is stored. One process holds the token in memory (as
// the cache), so the app runs as a single instance. A token from before rotation never expires.
@Injectable()
export default class AccessTokenService {
  private readonly logger = new Logger(AccessTokenService.name);

  // One load (and refresh) at a time per workspace: the other calls wait for
  // it, and then find the token in the cache. A call that read the token
  // from the database while a refresh ran would refresh again with a refresh
  // token that is no longer current.
  private readonly loading = new Map<string, Promise<string>>();

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly slackApiClient: SlackApiClient,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
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

  private async load(teamId: string): Promise<string> {
    const tokens = await this.slackTeamsService.findTokens(teamId);

    if (!tokens) {
      throw new NotFoundException('Team not found');
    }

    if (tokens.refreshToken && tokens.expiresAt && this.isDue(tokens)) {
      return this.refresh(teamId, tokens);
    }

    await this.remember(teamId, tokens);

    return tokens.token;
  }

  // After a reinstall or an uninstall the cached token is a revoked one.
  public async forget(teamId: string) {
    await this.cacheManager.del(this.cacheKey(teamId));
  }

  private isDue({ expiresAt }: IBotTokens) {
    return expiresAt!.getTime() - Date.now() < REFRESH_MARGIN_MS;
  }

  private async refresh(teamId: string, tokens: IBotTokens) {
    try {
      const response = await this.slackApiClient.makeCall<IRefreshResponse>(
        'oauth.v2.access',
        {
          grant_type: 'refresh_token',
          refresh_token: tokens.refreshToken,
          client_id: this.config.get<string>(EnvironmentVariable.SlackClientId),
          client_secret: this.config.get<string>(
            EnvironmentVariable.SlackClientSecret,
          ),
        },
      );
      const refreshed: IBotTokens = {
        token: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: new Date(Date.now() + response.expires_in * 1000),
      };

      await this.slackTeamsService.saveTokens(teamId, refreshed);
      await this.remember(teamId, refreshed);

      return refreshed.token;
    } catch (error) {
      // Refreshed early, so the old token may still be good for a while.
      if (tokens.expiresAt!.getTime() > Date.now()) {
        this.logger.warn(
          `Could not refresh the bot token of ${teamId}, using it until it expires: ${(error as Error).message}`,
        );

        return tokens.token;
      }

      throw error;
    }
  }

  // Cached until it is due for a refresh.
  private async remember(teamId: string, { token, expiresAt }: IBotTokens) {
    const ttl = expiresAt
      ? Math.min(
          CACHE_TTL_MS,
          expiresAt.getTime() - Date.now() - REFRESH_MARGIN_MS,
        )
      : CACHE_TTL_MS;

    if (ttl > 0) {
      await this.cacheManager.set(this.cacheKey(teamId), token, ttl);
    }
  }

  private cacheKey(teamId: string) {
    return `slack:access_token:${teamId}`;
  }
}
