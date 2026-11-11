import { EventEmitter2 } from '@nestjs/event-emitter';
import UserRole from 'src/common/enums/user-role.enum';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
import { TIME_ENTRIES_SUBMITTED } from 'src/time-entries/events/time-entries.events';

const userWith = (role: UserRole) =>
  ({ id: 'me', role, slack_team_id: 'team-1' }) as IUserViewModel;

const entry = (status: TimeEntryStatus) =>
  ({
    id: 'e',
    user_id: 'me',
    project_id: 'web',
    work_date: '2026-06-17',
    minutes: 60,
    status,
    slack_team_id: 'team-1',
  }) as ITimeEntryViewModel;

// Log Time's change and deletion write only an entry as it was checked: one
// submitted or deleted in between is refused with the check's own message.
describe('TimeEntriesService writes', () => {
  let repository: Record<
    'findOne' | 'findMany' | 'findBilledIds' | 'updateMany',
    jest.Mock
  >;
  let service: TimeEntriesService;
  let eventEmitter: { emitAsync: jest.Mock };
  // Whether each emitAsync came inside the transaction.
  let emittedInTransaction: boolean[];
  let inTransaction: boolean;

  beforeEach(() => {
    inTransaction = false;
    emittedInTransaction = [];
    eventEmitter = {
      emitAsync: jest.fn(() => {
        emittedInTransaction.push(inTransaction);

        return Promise.resolve([]);
      }),
    };
    repository = {
      findOne: jest.fn(),
      findMany: jest.fn(async () => []),
      findBilledIds: jest.fn(async () => new Set()),
      updateMany: jest.fn(async () => []),
    };
    service = new TimeEntriesService(
      repository as unknown as TimeEntriesRepository,
      new TimeEntriesValidationService(
        repository as unknown as TimeEntriesRepository,
      ),
      {} as ProjectsService,
      {} as GetUserProjectsQuery,
      eventEmitter as unknown as EventEmitter2,
      new TimeEntryWriter(repository as unknown as TimeEntriesRepository),
      {
        transaction: async <T>(work: () => Promise<T>) => {
          inTransaction = true;

          try {
            return await work();
          } finally {
            inTransaction = false;
          }
        },
      } as unknown as TransactionService,
    );
  });

  const notDeleted = { operator: 'is', value: null };
  const open = {
    operator: 'in',
    value: [TimeEntryStatus.Draft, TimeEntryStatus.Rejected],
  };

  it("refuses the owner's change of an entry submitted after its check", async () => {
    repository.findOne
      .mockResolvedValueOnce(entry(TimeEntryStatus.Draft))
      .mockResolvedValueOnce(entry(TimeEntryStatus.Submitted));

    await expect(
      service.update(
        { id: 'e', slackTeamId: 'team-1' },
        { minutes: 120, status: TimeEntryStatus.Draft },
        userWith(UserRole.Member),
      ),
    ).rejects.toThrow('Submitted time entries cannot be edited');
    expect(repository.updateMany).toHaveBeenCalledWith(
      {
        id: 'e',
        slack_team_id: 'team-1',
        deleted_at: notDeleted,
        status: open,
      },
      expect.objectContaining({ minutes: 120, rejection_reason: null }),
    );
  });

  it('answers a deletion of an entry deleted after its check as not found', async () => {
    repository.findOne
      .mockResolvedValueOnce(entry(TimeEntryStatus.Draft))
      .mockResolvedValueOnce(null);

    await expect(
      service.delete(
        { id: 'e', slackTeamId: 'team-1' },
        userWith(UserRole.Member),
      ),
    ).rejects.toThrow('Time Entry not found');
  });

  // Its listener saves the approvers' jobs with the entries' new status.
  it('tells of submitted entries inside the transaction that submits them', async () => {
    const submitted = entry(TimeEntryStatus.Submitted);
    repository.updateMany.mockResolvedValue([submitted]);

    await service.submit({ slackTeamId: 'team-1' }, userWith(UserRole.Member));

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      TIME_ENTRIES_SUBMITTED,
      expect.objectContaining({ entries: [submitted], submittedById: 'me' }),
    );
    expect(emittedInTransaction).toEqual([true]);
  });

  it('tells nobody when there was nothing to submit', async () => {
    await service.submit({ slackTeamId: 'team-1' }, userWith(UserRole.Member));

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('lets Admin and HR change an entry whatever its status', async () => {
    const submitted = entry(TimeEntryStatus.Submitted);
    repository.findOne.mockResolvedValue(submitted);
    repository.updateMany.mockResolvedValue([{ ...submitted, minutes: 120 }]);

    await service.update(
      { id: 'e', slackTeamId: 'team-1' },
      { minutes: 120 },
      userWith(UserRole.HR),
    );

    expect(repository.updateMany).toHaveBeenCalledWith(
      { id: 'e', slack_team_id: 'team-1', deleted_at: notDeleted },
      expect.objectContaining({ minutes: 120 }),
    );
  });
});
