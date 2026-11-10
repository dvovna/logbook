import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  BILLED_ENTRY_MESSAGE,
  isBilledEntryError,
} from 'src/time-entries/constants/billed-time-entries';

const member: IUserViewModel = {
  id: 'user-1',
  email: 'member@example.com',
  name: 'Member',
  role: UserRole.Member,
  is_active: true,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U_MEMBER',
  created_at: '2026-01-01T00:00:00Z',
};

const entryParams = {
  userId: member.id,
  projectId: 'project-1',
  workDate: new Date('2026-06-17'),
  minutes: 60,
  status: TimeEntryStatus.Draft,
};

describe('TimeEntriesValidationService', () => {
  let service: TimeEntriesValidationService;

  beforeEach(() => {
    service = new TimeEntriesValidationService({
      findMany: jest.fn().mockResolvedValue([]),
      findBilledIds: jest.fn().mockResolvedValue(new Set()),
    } as unknown as TimeEntriesRepository);
  });

  describe('the status a member creates an entry with', () => {
    it.each([TimeEntryStatus.Draft, TimeEntryStatus.Submitted])(
      'may be %s',
      async (status) => {
        await expect(
          service.validateCreate({ ...entryParams, status }, member),
        ).resolves.toBeUndefined();
      },
    );

    it.each([TimeEntryStatus.Rejected, TimeEntryStatus.Cancelled])(
      'may not be %s',
      async (status) => {
        await expect(
          service.validateCreate({ ...entryParams, status }, member),
        ).rejects.toThrow(ForbiddenException);
      },
    );
  });

  describe('a description over 200 characters', () => {
    const description = 'x'.repeat(201);

    it('is refused on create', async () => {
      const error: unknown = await service
        .validateCreate({ ...entryParams, description }, member)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'description' });
    });

    it('is refused on edit', async () => {
      const existing = {
        id: 'entry-1',
        user_id: member.id,
        project_id: 'project-1',
        work_date: '2026-06-17',
        minutes: 60,
        status: TimeEntryStatus.Draft,
      } as ITimeEntryViewModel;

      const error: unknown = await service
        .validateUpdate(existing, { description }, member)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'description' });
    });
  });
});

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole, id = 'admin') =>
  ({ id, role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const approvedEntry = {
  id: 'entry-1',
  user_id: 'owner',
  project_id: 'web',
  work_date: '2026-10-05',
  minutes: 60,
  status: TimeEntryStatus.Approved,
  slack_team_id: SLACK_TEAM_ID,
} as ITimeEntryViewModel;

describe('TimeEntriesValidationService and billing snapshots', () => {
  let billed: Set<string>;
  let repository: { findBilledIds: jest.Mock; findMany: jest.Mock };
  let service: TimeEntriesValidationService;

  beforeEach(() => {
    billed = new Set(['entry-1']);
    repository = {
      findBilledIds: jest.fn(async () => billed),
      findMany: jest.fn().mockResolvedValue([]),
    };
    service = new TimeEntriesValidationService(
      repository as unknown as TimeEntriesRepository,
    );
  });

  describe('an entry in a billing snapshot', () => {
    it.each([UserRole.Admin, UserRole.HR])(
      'is not edited or un-approved by %s',
      async (role) => {
        for (const update of [
          { minutes: 30 },
          { status: TimeEntryStatus.Draft },
          { description: 'Fixed' },
        ]) {
          await expect(
            service.validateUpdate(approvedEntry, update, userWith(role)),
          ).rejects.toThrow(new ValidationError(BILLED_ENTRY_MESSAGE));
        }

        expect(repository.findBilledIds).toHaveBeenCalledWith(SLACK_TEAM_ID, [
          'entry-1',
        ]);
      },
    );

    it('is not deleted, by an admin either', async () => {
      await expect(
        service.validateDelete(approvedEntry, userWith(UserRole.Admin)),
      ).rejects.toThrow(new ValidationError(BILLED_ENTRY_MESSAGE));
    });

    it("tells its owner first that approved entries don't change", async () => {
      await expect(
        service.validateDelete(
          approvedEntry,
          userWith(UserRole.Member, 'owner'),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it('lets an admin change an approved entry that no snapshot holds', async () => {
    billed.clear();

    await expect(
      service.validateUpdate(
        approvedEntry,
        { minutes: 30 },
        userWith(UserRole.Admin),
      ),
    ).resolves.toBeUndefined();
    await expect(
      service.validateDelete(approvedEntry, userWith(UserRole.HR)),
    ).resolves.toBeUndefined();
  });
});

describe('isBilledEntryError', () => {
  it("knows the trigger's error, as the driver throws it or wrapped", () => {
    const fromDriver = Object.assign(new Error('in a billing snapshot'), {
      code: 'LB001',
    });
    const wrapped = Object.assign(new Error('[time_entries] update error'), {
      cause: fromDriver,
    });

    expect(isBilledEntryError(fromDriver)).toBe(true);
    expect(isBilledEntryError(wrapped)).toBe(true);
    expect(
      isBilledEntryError(Object.assign(new Error('dup'), { code: '23505' })),
    ).toBe(false);
    expect(isBilledEntryError(undefined)).toBe(false);
  });
});
