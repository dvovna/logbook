import { OnEvent } from '@nestjs/event-emitter';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
  VacationRequestDeletedEvent,
} from 'src/vacation-requests/events/vacation-request.events';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { getCurrentVacationPeriod } from 'src/vacation-requests/utils/vacation-period.utils';
import { UsersService } from 'src/users/services/users.service';

export interface IVacationDaysCacheValue {
  annualLeaveUsed: number;
  annualLeaveWorkingDaysUsed: number;
  bonusUsed: number;
  sickUsed: number;
  unpaidUsed: number;
  otherUsed: number;
}

const DEFAULT_TTL_SECONDS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

@Injectable()
export class VacationPeriodUsageCacheService {
  private readonly logger = new Logger(VacationPeriodUsageCacheService.name);

  public constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly usersService: UsersService,
  ) {}

  private getCacheKey(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
  ): string {
    return `vacation-usage:${userId}:${periodStart.toISOString()}:${periodEnd.toISOString()}`;
  }

  public get(userId: string, periodStart: Date, periodEnd: Date) {
    return this.cacheManager.get<IVacationDaysCacheValue>(
      this.getCacheKey(userId, periodStart, periodEnd),
    );
  }

  public async set(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    value: IVacationDaysCacheValue,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ) {
    await this.cacheManager.set(
      this.getCacheKey(userId, periodStart, periodEnd),
      value,
      ttlSeconds,
    );
  }

  public async delete(userId: string, periodStart: Date, periodEnd: Date) {
    await this.cacheManager.del(
      this.getCacheKey(userId, periodStart, periodEnd),
    );

    this.logger.debug(
      `Cache invalidated for user=${userId} period=${periodStart.toDateString()}–${periodEnd.toDateString()}`,
    );
  }

  @OnEvent(VacationRequestEvent.Created)
  @OnEvent(VacationRequestEvent.Updated)
  @OnEvent(VacationRequestEvent.Deleted)
  public async handleRequestEvent(
    event:
      | VacationRequestCreatedEvent
      | VacationRequestUpdatedEvent
      | VacationRequestDeletedEvent,
  ) {
    const { request } = event;
    const user = await this.usersService.findOneWithValidation({
      id: request.user_id,
      slackTeamId: request.slack_team_id,
    });

    if (!user.contract_start_date) {
      this.logger.warn(
        `User ${user.id} does not have a contract start date. Skipping cache invalidation.`,
      );

      return;
    }

    const { periodStart, periodEnd } = getCurrentVacationPeriod(
      user.contract_start_date,
    );

    await this.delete(user.id, periodStart, periodEnd);
  }
}
