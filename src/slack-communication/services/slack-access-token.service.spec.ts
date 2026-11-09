import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import {
  IBotTokens,
  SlackTeamsService,
} from 'src/slack-teams/slack-teams.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';

const TEAM = 'b7a1c2d4-0000-4000-8000-000000000001';
const MINUTE = 60 * 1000;

describe('AccessTokenService', () => {
  let stored: IBotTokens | null;
  let teams: { findTokens: jest.Mock; saveTokens: jest.Mock };
  let slack: { makeCall: jest.Mock };
  let service: AccessTokenService;

  beforeEach(() => {
    const cache = new Map<string, unknown>();
    teams = {
      findTokens: jest.fn(async () => stored),
      saveTokens: jest.fn(async (_id: string, tokens: IBotTokens) => {
        stored = tokens;
      }),
    };
    slack = {
      makeCall: jest.fn().mockResolvedValue({
        access_token: 'xoxe.xoxb-new',
        refresh_token: 'xoxe-1-new',
        expires_in: 43200,
      }),
    };
    service = new AccessTokenService(
      teams as unknown as SlackTeamsService,
      slack as unknown as SlackApiClient,
      { get: (key: string) => key } as unknown as ConfigService,
      {
        get: async (key: string) => cache.get(key),
        set: async (key: string, value: unknown) => cache.set(key, value),
        del: async (key: string) => cache.delete(key),
      } as unknown as Cache,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const rotating = (expiresInMs: number): IBotTokens => ({
    token: 'xoxe.xoxb-old',
    refreshToken: 'xoxe-1-old',
    expiresAt: new Date(Date.now() + expiresInMs),
  });

  it('uses a token that never expires as it is', async () => {
    stored = { token: 'xoxb-plain', refreshToken: null, expiresAt: null };

    expect(await service.getAccessToken(TEAM)).toBe('xoxb-plain');
    expect(slack.makeCall).not.toHaveBeenCalled();
  });

  it('uses a rotating token with hours left, and caches it', async () => {
    stored = rotating(60 * MINUTE);

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
    expect(teams.findTokens).toHaveBeenCalledTimes(1);
    expect(slack.makeCall).not.toHaveBeenCalled();
  });

  it('refreshes a token about to expire and stores the new pair', async () => {
    stored = rotating(5 * MINUTE);

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-new');
    expect(slack.makeCall).toHaveBeenCalledWith('oauth.v2.access', {
      grant_type: 'refresh_token',
      refresh_token: 'xoxe-1-old',
      client_id: 'SLACK_CLIENT_ID',
      client_secret: 'SLACK_CLIENT_SECRET',
    });
    expect(teams.saveTokens).toHaveBeenCalledWith(
      TEAM,
      expect.objectContaining({
        token: 'xoxe.xoxb-new',
        refreshToken: 'xoxe-1-new',
      }),
    );
  });

  it('keeps using the old token while it lasts when Slack refuses the refresh', async () => {
    stored = rotating(5 * MINUTE);
    slack.makeCall.mockRejectedValue(new Error('ratelimited'));

    expect(await service.getAccessToken(TEAM)).toBe('xoxe.xoxb-old');
  });

  it('fails when the token has expired and cannot be refreshed', async () => {
    stored = rotating(-MINUTE);
    slack.makeCall.mockRejectedValue(new Error('invalid_refresh_token'));

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
});
