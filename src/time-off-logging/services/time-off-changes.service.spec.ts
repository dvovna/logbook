import { EventEmitter2 } from '@nestjs/event-emitter';
import UserRole from 'src/common/enums/user-role.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { vacationRequestLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { TimeOffChangedEvent } from 'src/time-off-logging/events/time-off.events';
import { TimeOffChangesService } from 'src/time-off-logging/services/time-off-changes.service';
import { VacationTimeService } from 'src/time-off-logging/services/vacation-time.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from 'src/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_team_id: SLACK_TEAM_ID,
} as IUserViewModel;

const approved = {
  id: 'request-1',
  user_id: 'user-1',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  type: VacationType.AnnualLeave,
  status: VacationRequestStatus.Approved,
  slack_team_id: SLACK_TEAM_ID,
} as IVacationRequestViewModel;

const removedTime = {
  deleted: 3,
  owners: [{ userId: 'user-1', minutes: 1440, projectIds: ['p1'] }],
  billedDates: ['2026-02-04'],
};

// Time logged from an approved vacation goes when the vacation changes.
describe('TimeOffChangesService', () => {
  let requests: Record<
    'checkUpdate' | 'applyUpdate' | 'findOneWithValidation' | 'applyDelete',
    jest.Mock
  >;
  let vacationTime: { remove: jest.Mock };
  let eventEmitter: { emitAsync: jest.Mock };
  let lock: jest.Mock;
  // Which calls ran inside TransactionService.transaction().
  let inTransaction: boolean;
  let service: TimeOffChangesService;

  beforeEach(() => {
    inTransaction = false;
    requests = {
      checkUpdate: jest.fn().mockResolvedValue({ checked: approved }),
      applyUpdate: jest.fn(),
      findOneWithValidation: jest.fn().mockResolvedValue(approved),
      applyDelete: jest.fn(),
    };
    vacationTime = {
      remove: jest.fn(() => {
        expect(inTransaction).toBe(true);

        return Promise.resolve(removedTime);
      }),
    };
    // The listeners save their jobs with the change: inside the transaction.
    eventEmitter = {
      emitAsync: jest.fn(() => {
        expect(inTransaction).toBe(true);

        return Promise.resolve([]);
      }),
    };
    lock = jest.fn();
    service = new TimeOffChangesService(
      requests as unknown as VacationRequestsService,
      vacationTime as unknown as VacationTimeService,
      {
        transaction: async <T>(work: () => Promise<T>) => {
          inTransaction = true;

          try {
            return await work();
          } finally {
            inTransaction = false;
          }
        },
        lock,
      } as unknown as TransactionService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  const applies = (
    previous: IVacationRequestViewModel,
    request: IVacationRequestViewModel,
  ) =>
    requests.applyUpdate.mockImplementation(() => {
      expect(inTransaction).toBe(true);

      return Promise.resolve({ previous, request });
    });

  const update = (changes = {}) =>
    service.update(
      { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
      changes,
      hr,
    );

  it.each([
    ['the days', { end_date: '2026-02-09' }],
    ['the status', { status: VacationRequestStatus.Rejected }],
    ['the type', { type: VacationType.SickLeave }],
    ['the person', { user_id: 'user-2' }],
  ])(
    'is removed with an edit of %s, in its transaction',
    async (_change, changed) => {
      const changedRequest = { ...approved, ...changed };
      applies(approved, changedRequest);

      const result = await update();

      expect(lock).toHaveBeenCalledWith(vacationRequestLock('request-1'));
      expect(lock.mock.invocationCallOrder[0]).toBeLessThan(
        requests.applyUpdate.mock.invocationCallOrder[0],
      );

      expect(requests.applyUpdate).toHaveBeenCalledWith(
        { checked: approved },
        hr,
      );
      expect(vacationTime.remove).toHaveBeenCalledWith(
        'request-1',
        SLACK_TEAM_ID,
        hr,
      );
      expect(result).toEqual({
        request: changedRequest,
        billedDates: ['2026-02-04'],
      });
      // Whose time it was hears what went.
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        new TimeOffChangedEvent(changedRequest, hr, approved, removedTime),
      );
    },
  );

  // Setting the status is a decision by the editor, told as the workflow's
  // is; the listeners save its jobs in the edit's transaction.
  it.each([
    [VacationRequestStatus.Pending, VacationRequestStatus.Approved],
    [VacationRequestStatus.Pending, VacationRequestStatus.Rejected],
    [VacationRequestStatus.Approved, VacationRequestStatus.Rejected],
    [VacationRequestStatus.Rejected, VacationRequestStatus.Approved],
  ])(
    'decides a request that goes from %s to %s, after telling of the edit',
    async (from, to) => {
      const previous = { ...approved, status: from };
      const decided = { ...approved, status: to };
      applies(previous, decided);

      await update({ status: to });

      expect(eventEmitter.emitAsync.mock.calls).toEqual([
        [
          VacationRequestEvent.Updated,
          expect.objectContaining({ request: decided, previous }),
        ],
        [
          VacationRequestEvent.Decided,
          new VacationRequestDecidedEvent(decided, hr),
        ],
      ]);
    },
  );

  // A second submit of the form finds the request decided under the lock.
  it.each([
    ['keeps its status', VacationRequestStatus.Approved],
    ['becomes pending again', VacationRequestStatus.Pending],
    ['is canceled', VacationRequestStatus.Canceled],
  ])('decides nothing when the request %s', async (_change, status) => {
    applies(approved, { ...approved, status, end_date: '2026-02-09' });

    await update({ status });

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      VacationRequestEvent.Updated,
      expect.anything(),
    );
  });

  // The requester withdrew it: setting it again records the outcome.
  it.each([VacationRequestStatus.Approved, VacationRequestStatus.Rejected])(
    'decides nothing when a canceled request is set to %s',
    async (status) => {
      applies(
        { ...approved, status: VacationRequestStatus.Canceled },
        { ...approved, status },
      );

      await update({ status });

      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        expect.anything(),
      );
    },
  );

  it('stays with an edit of the comment', async () => {
    applies(approved, { ...approved, user_comment: 'Family trip' });

    const result = await update({ userComment: 'Family trip' });

    expect(vacationTime.remove).not.toHaveBeenCalled();
    expect(result.billedDates).toEqual([]);
  });

  // HR's form read the request while it was pending; the workflow approved
  // it before the lock, and the requester logged it. An edit of the comment
  // changes nothing of that time.
  it('compares with the request as it is under the lock', async () => {
    requests.checkUpdate.mockResolvedValue({
      checked: { ...approved, status: VacationRequestStatus.Pending },
    });
    applies(approved, { ...approved, user_comment: 'Family trip' });

    await update({ userComment: 'Family trip' });

    expect(vacationTime.remove).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      VacationRequestEvent.Updated,
      expect.objectContaining({ previous: approved }),
    );
  });

  it('reads the request under its lock and removes the time before deleting it', async () => {
    const calls: string[] = [];
    lock.mockImplementation(() => {
      calls.push(`lock, in a transaction: ${inTransaction}`);
    });
    requests.findOneWithValidation.mockImplementation(() => {
      calls.push(`read, in a transaction: ${inTransaction}`);

      return Promise.resolve(approved);
    });
    vacationTime.remove.mockImplementation(() => {
      calls.push(`time, in a transaction: ${inTransaction}`);

      return Promise.resolve(removedTime);
    });
    requests.applyDelete.mockImplementation(() => {
      calls.push(`request, in a transaction: ${inTransaction}`);
    });
    eventEmitter.emitAsync.mockImplementation(() => {
      calls.push(`event, in a transaction: ${inTransaction}`);

      return Promise.resolve([]);
    });

    const result = await service.delete(
      { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
      hr,
    );

    expect(lock).toHaveBeenCalledWith(vacationRequestLock('request-1'));
    expect(requests.applyDelete).toHaveBeenCalledWith(approved, hr);
    expect(calls).toEqual([
      'lock, in a transaction: true',
      'read, in a transaction: true',
      'time, in a transaction: true',
      'request, in a transaction: true',
      'event, in a transaction: true',
    ]);
    expect(result).toEqual({ request: approved, billedDates: ['2026-02-04'] });
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      VacationRequestEvent.Deleted,
      new TimeOffChangedEvent(approved, hr, undefined, removedTime),
    );
  });
});
