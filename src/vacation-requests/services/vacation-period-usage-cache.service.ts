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

export interface IVacationDaysCacheValue {
  annualLeaveUsed: number;
  annualLeaveWorkingDaysUsed: number;
  bonusUsed: number;
  sickUsed: number;
  unpaidUsed: number;
  otherUsed: number;
}

interface ICachedPeriodUsage {
  periodStart: string;
  periodEnd: string;
  usage: IVacationDaysCacheValue;
}

const DEFAULT_TTL_SECONDS = 6 * 60 * 60 * 1000; // 6 hours in milliseconds

// One entry per user, holding the usage of the period it was computed for.
// Keying by user alone lets a request event drop the entry without knowing
// the owner's vacation period.
@Injectable()
export class VacationPeriodUsageCacheService {
  private readonly logger = new Logger(VacationPeriodUsageCacheService.name);

  public constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  private getCacheKey(userId: string): string {
    return `vacation-usage:${userId}`;
  }

  public async get(userId: string, periodStart: Date, periodEnd: Date) {
    const cached = await this.cacheManager.get<ICachedPeriodUsage>(
      this.getCacheKey(userId),
    );

    const isSamePeriod =
      cached?.periodStart === periodStart.toISOString() &&
      cached?.periodEnd === periodEnd.toISOString();

    return isSamePeriod ? cached.usage : undefined;
  }

  public async set(
    userId: string,
    periodStart: Date,
    periodEnd: Date,
    value: IVacationDaysCacheValue,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ) {
    await this.cacheManager.set<ICachedPeriodUsage>(
      this.getCacheKey(userId),
      {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        usage: value,
      },
      ttlSeconds,
    );
  }

  public async delete(userId: string) {
    await this.cacheManager.del(this.getCacheKey(userId));

    this.logger.debug(`Cache invalidated for user=${userId}`);
  }

  // The event's `user` is whoever made the change (an approver or an admin),
  // so the request owner is taken from the request itself.
  @OnEvent(VacationRequestEvent.Created)
  @OnEvent(VacationRequestEvent.Updated)
  @OnEvent(VacationRequestEvent.Deleted)
  public async handleRequestEvent({
    request,
  }:
    | VacationRequestCreatedEvent
    | VacationRequestUpdatedEvent
    | VacationRequestDeletedEvent) {
    await this.delete(request.user_id);
  }
}
