import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

const CACHE_TTL = 3600 * 24; // 1 day

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

    await this.cacheManager.set(cacheKey, token, CACHE_TTL);

    return token;
  }

  private getCacheKey(teamId: string) {
    return `slack:access_token:${teamId}`;
  }
}
