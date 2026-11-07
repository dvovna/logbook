import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

// A day. cache-manager takes milliseconds.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export default class AccessTokenService {
  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  public async getAccessToken(teamId: string): Promise<string> {
    const cacheKey = this.getCacheKey(teamId);
    const cached = await this.cacheManager.get<string>(cacheKey);

    if (cached) {
      return cached;
    }

    const token = await this.slackTeamsService.findAccessToken(teamId);

    if (!token) {
      throw new NotFoundException('Team not found');
    }

    await this.cacheManager.set(cacheKey, token, CACHE_TTL_MS);

    return token;
  }

  // After a reinstall the cached token is a revoked one.
  public async forget(teamId: string) {
    await this.cacheManager.del(this.getCacheKey(teamId));
  }

  private getCacheKey(teamId: string) {
    return `slack:access_token:${teamId}`;
  }
}
