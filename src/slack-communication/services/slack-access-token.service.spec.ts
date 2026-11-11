import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import AccessTokenService, {
  RETRY_REFRESH_AFTER_MS,
} from 'src/slack-communication/services/slack-access-token.service';
import {
  IBotTokens,
  IStoredBotTokens,
  SlackTeamsService,
} from 'src/slack-teams/slack-teams.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { TransactionService } from 'src/database/transaction.service';
import { slackTokenLock } from 'src/database/advisory-locks';

const TEAM = 'b7a1c2d4-0000-4000-8000-000000000001';
const MINUTE = 60 * 1000;

describe('AccessTokenService', () => {
  let stored: IStoredBotTokens | null;
  let teams: {
    findTokens: jest.Mock;
    saveRefreshedTokens: jest.Mock;
  };
  let slack: { refreshToken: jest.Mock };
  let transactions: { transaction: jest.Mock; lock: jest.Mock };
  let service: AccessTokenService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-06-17T09:00:00Z') });

    // cache-manager's TTLs, by the clock.
    const cache = new Map<string, { value: unknown; until: number }>();
    let saved = 0;
    teams = {
      findTokens: jest.fn(async () => stored),
      saveRefreshedTokens: jest.fn(
        async (_id: string, previous: IStoredBotTokens, next: IBotTokens) => {
          if (stored?.storedRefreshToken !== previous.storedRefreshToken) {
            return false;
          }

          saved += 1;
          stored = { ...next, storedRefreshToken: `v1:saved-${saved}` };

          return true;
        },
      ),
    };
    slack = {
      refreshToken: jest.fn().mockResolvedValue({
        access_token: 'xoxe.xoxb-new',
        refresh_token: 'xoxe-1-new',
        expires_in: 43200,
      }),
    };
    transactions = {
      transaction: jest.fn((work: () => Promise<unknown>) => work()),
      lock: jest.fn().mockResolvedValue(undefined),
    };
    service = new AccessTokenService(
      teams as unknown as SlackTeamsService,
      slack as unknown as SlackApiClient,
      { getOrThrow: (key: string) => key } as unknown as ConfigService,
      {
        get: async (key: string) => {
          const entry = cache.get(key);

          return entry && entry.until > Date.now() ? entry.value : undefined;
        },
        set: async (key: string, value: unknown, ttl: number) =>
          cache.set(key, { value, until: Date.now() + ttl }),
        del: async (key: string) => cache.delete(key),
      } as unknown as Cache,
      transactions as unknown as TransactionService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const rotating = (
    expiresInMs: number,
    token = 'xoxe.xoxb-old',
  ): IStoredBotTokens => ({
    token,
    refreshToken: 'xoxe-1-old',
    expiresAt: new Date(Date.now() + expiresInMs),
    storedRefreshToken: `v1:${token}`,
  });

  it('uses a token that never expires as it is', async () => {
    stored = {
      token: 'xoxb-plain',
      refreshToken: null,
      expiresAt: null,
      storedRefreshToken: null,
    };

    expect(await service.getAccessToken(TEAM)).toBe('xoxb-plain');
    expect(slack.refreshToken).not.toHaveBeenCalled();
  });

  it('uses a rotating token with hours left, and caches it until it is due', async () => {
    stored = rotating(60 * MINUTE);

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
    expect(teams.findTokens).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(51 * MINUTE);
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-new');
    expect(slack.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes a token about to expire under the workspace lock, and stores the new pair over the old one', async () => {
    stored = rotating(5 * MINUTE);
    const old = stored;

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-new');

    expect(transactions.lock).toHaveBeenCalledWith(slackTokenLock(TEAM));
    expect(slack.refreshToken).toHaveBeenCalledWith({
      refreshToken: 'xoxe-1-old',
      clientId: 'SLACK_CLIENT_ID',
      clientSecret: 'SLACK_CLIENT_SECRET',
    });
    expect(teams.saveRefreshedTokens).toHaveBeenCalledWith(TEAM, old, {
      token: 'xoxe.xoxb-new',
      refreshToken: 'xoxe-1-new',
      expiresAt: new Date(Date.now() + 43200 * 1000),
    });
    expect(stored).toMatchObject({
      token: 'xoxe.xoxb-new',
      refreshToken: 'xoxe-1-new',
    });
  });

  it('uses the pair another process refreshed while it waited for the lock', async () => {
    stored = rotating(5 * MINUTE);
    transactions.lock.mockImplementation(async () => {
      stored = rotating(12 * 60 * MINUTE, 'xoxe.xoxb-theirs');
    });

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-theirs');
    expect(slack.refreshToken).not.toHaveBeenCalled();
    expect(teams.saveRefreshedTokens).not.toHaveBeenCalled();
  });

  // The compare-and-set: a reinstall stored a new pair while Slack answered.
  it('keeps a pair stored during its refresh, and uses that one', async () => {
    stored = rotating(5 * MINUTE);
    slack.refreshToken.mockImplementation(async () => {
      stored = {
        token: 'xoxb-reinstalled',
        refreshToken: null,
        expiresAt: null,
        storedRefreshToken: null,
      };

      return {
        access_token: 'xoxe.xoxb-new',
        refresh_token: 'xoxe-1-new',
        expires_in: 43200,
      };
    });

    expect(await service.getAccessToken(TEAM)).toBe('xoxb-reinstalled');
    expect(stored?.token).toBe('xoxb-reinstalled');
    expect(await service.getAccessToken(TEAM)).toBe('xoxb-reinstalled');
    expect(slack.refreshToken).toHaveBeenCalledTimes(1);
  });

  it('keeps using the old token for a minute when Slack refuses the refresh, then tries again', async () => {
    stored = rotating(5 * MINUTE);
    slack.refreshToken.mockRejectedValueOnce(new Error('ratelimited'));

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');

    jest.advanceTimersByTime(RETRY_REFRESH_AFTER_MS - 1);
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
    expect(teams.findTokens).toHaveBeenCalledTimes(2);
    expect(slack.refreshToken).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-new');
    expect(slack.refreshToken).toHaveBeenCalledTimes(2);
  });

  it('keeps the old token after a failed refresh no longer than it lasts', async () => {
    stored = rotating(MINUTE / 2);
    slack.refreshToken.mockRejectedValueOnce(new Error('ratelimited'));

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');

    jest.advanceTimersByTime(MINUTE / 2);
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-new');
  });

  it('fails when the token has expired and cannot be refreshed', async () => {
    stored = rotating(-MINUTE);
    slack.refreshToken.mockRejectedValue(new Error('invalid_refresh_token'));

    await expect(service.getAccessToken(TEAM)).rejects.toThrow(
      'invalid_refresh_token',
    );
  });

  it('refuses a workspace without a token (unknown or uninstalled)', async () => {
    stored = null;

    await expect(service.getAccessToken(TEAM)).rejects.toThrow(
      'Team not found',
    );
  });

  describe('reload', () => {
    it('drops a refused token and reads the stored one', async () => {
      stored = rotating(60 * MINUTE);
      await service.getAccessToken(TEAM);
      stored = rotating(60 * MINUTE, 'xoxe.xoxb-reinstalled');

      expect(await service.reload(TEAM, 'xoxe.xoxb-old')).toBe(
        'xoxe.xoxb-reinstalled',
      );
      expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-reinstalled');
    });

    it('keeps a token another call cached since', async () => {
      stored = rotating(60 * MINUTE, 'xoxe.xoxb-newer');
      await service.getAccessToken(TEAM);

      expect(await service.reload(TEAM, 'xoxe.xoxb-old')).toBe(
        'xoxe.xoxb-newer',
      );
      expect(teams.findTokens).toHaveBeenCalledTimes(1);
    });
  });
});
