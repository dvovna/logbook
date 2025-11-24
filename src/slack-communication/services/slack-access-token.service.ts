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

    const team = await this.slackTeamsService.findOne({ id: teamId });

    if (!team) {
      throw new NotFoundException('Team not found');
    }

    await this.cacheManager.set(cacheKey, team.access_token, CACHE_TTL);

    return team.access_token;
  }

  private getCacheKey(teamId: string) {
    return `slack:access_token:${teamId}`;
  }
}
