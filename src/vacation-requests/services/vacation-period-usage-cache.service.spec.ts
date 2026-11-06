import { Cache } from 'cache-manager';
import { VacationPeriodUsageCacheService } from 'src/vacation-requests/services/vacation-period-usage-cache.service';
import { VacationRequestUpdatedEvent } from 'src/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

const usage = {
  annualLeaveUsed: 5,
  annualLeaveWorkingDaysUsed: 5,
  bonusUsed: 0,
  sickUsed: 0,
  unpaidUsed: 0,
  otherUsed: 0,
};

const periodStart = new Date('2026-01-01');
const periodEnd = new Date('2026-12-31');

describe('VacationPeriodUsageCacheService', () => {
  let store: Map<string, unknown>;
  let service: VacationPeriodUsageCacheService;

  beforeEach(() => {
    store = new Map();
    const cacheManager = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      del: jest.fn((key: string) => Promise.resolve(store.delete(key))),
    };

    service = new VacationPeriodUsageCacheService(
      cacheManager as unknown as Cache,
    );
  });

  it('returns the cached usage for the same period', async () => {
    await service.set('user-1', periodStart, periodEnd, usage);

    await expect(
      service.get('user-1', periodStart, periodEnd),
    ).resolves.toEqual(usage);
  });

  it('ignores usage cached for another period', async () => {
    await service.set('user-1', periodStart, periodEnd, usage);

    await expect(
      service.get('user-1', new Date('2026-05-15'), new Date('2027-05-14')),
    ).resolves.toBeUndefined();
  });

  it("drops the request owner's usage, not the usage of whoever changed it", async () => {
    await service.set('requester-1', periodStart, periodEnd, usage);
    await service.set('approver-1', periodStart, periodEnd, usage);

    await service.handleRequestEvent(
      new VacationRequestUpdatedEvent(
        { user_id: 'requester-1' } as IVacationRequestViewModel,
        { id: 'approver-1' } as IUserViewModel,
      ),
    );

    await expect(
      service.get('requester-1', periodStart, periodEnd),
    ).resolves.toBeUndefined();
    await expect(
      service.get('approver-1', periodStart, periodEnd),
    ).resolves.toEqual(usage);
  });
});
