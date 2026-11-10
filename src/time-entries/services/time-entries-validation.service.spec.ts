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

describe('TimeEntriesValidationService permissions and limits', () => {
  const SLACK_TEAM_ID = 'slack-team-1';
  const PROJECT_ID = 'project-1';
  const WORK_DATE = new Date('2026-06-17');

  const user = (id: string, role: UserRole) =>
    ({ id, role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

  const member = user('member-1', UserRole.Member);
  const otherMember = user('member-2', UserRole.Member);
  const manager = user('manager-1', UserRole.Manager);
  const hr = user('hr-1', UserRole.HR);
  const admin = user('admin-1', UserRole.Admin);

  const entry = (overrides: Partial<ITimeEntryViewModel> = {}) =>
    ({
      id: 'entry-1',
      user_id: member.id,
      project_id: PROJECT_ID,
      work_date: '2026-06-17',
      minutes: 60,
      status: TimeEntryStatus.Draft,
      slack_team_id: SLACK_TEAM_ID,
      ...overrides,
    }) as ITimeEntryViewModel;

  let repository: { findMany: jest.Mock; findBilledIds: jest.Mock };
  let service: TimeEntriesValidationService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      findBilledIds: jest.fn().mockResolvedValue(new Set()),
    };
    service = new TimeEntriesValidationService(
      repository as unknown as TimeEntriesRepository,
    );
  });

  const create = (
    actor: IUserViewModel,
    overrides: Partial<{
      userId: string;
      minutes: number;
      status: TimeEntryStatus;
    }> = {},
  ) =>
    service.validateCreate(
      {
        userId: actor.id,
        projectId: PROJECT_ID,
        workDate: WORK_DATE,
        minutes: 60,
        status: TimeEntryStatus.Draft,
        ...overrides,
      },
      actor,
    );

  describe('minutes', () => {
    it.each([
      [0, 'Logged minutes must be greater than 0'],
      [-15, 'Logged minutes must be greater than 0'],
      [24 * 60 + 15, 'Logged minutes cannot exceed 1440'],
      [20, 'Logged minutes must be in 15 - minute increments'],
    ])('rejects %i minutes at the minutes field', async (minutes, message) => {
      const error = await create(member, { minutes }).catch((e) => e);

      expect(error).toEqual(new ValidationError(message, 'minutes'));
      expect(error.field).toBe('minutes');
    });

    it('accepts a whole day in 15-minute steps', async () => {
      await expect(create(member, { minutes: 24 * 60 })).resolves.toBe(
        undefined,
      );
    });

    it('checks the minutes of an update too', async () => {
      await expect(
        service.validateUpdate(entry(), { minutes: 50 }, member),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('logging time for someone else', () => {
    it.each([member, manager])('is forbidden to a $role', async (actor) => {
      await expect(create(actor, { userId: otherMember.id })).rejects.toThrow(
        new ForbiddenException('You cannot log time for another user'),
      );
      expect(repository.findMany).not.toHaveBeenCalled();
    });

    it.each([hr, admin])('is allowed to $role', async (actor) => {
      await expect(create(actor, { userId: member.id })).resolves.toBe(
        undefined,
      );
    });
  });

  describe('approved entries', () => {
    it.each([member, manager])('a $role cannot create one', async (actor) => {
      await expect(
        create(actor, { status: TimeEntryStatus.Approved }),
      ).rejects.toThrow(
        new ForbiddenException('Only admins can create approved entries'),
      );
    });

    it.each([hr, admin])('$role can create one', async (actor) => {
      await expect(
        create(actor, { status: TimeEntryStatus.Approved }),
      ).resolves.toBe(undefined);
    });

    it('the owner cannot approve their own entry by updating its status', async () => {
      await expect(
        service.validateUpdate(
          entry({ status: TimeEntryStatus.Draft }),
          { status: TimeEntryStatus.Approved },
          member,
        ),
      ).rejects.toThrow(
        new ForbiddenException('Only admins can approve entries'),
      );
    });

    it('the owner may submit a draft', async () => {
      await expect(
        service.validateUpdate(
          entry({ status: TimeEntryStatus.Draft }),
          { status: TimeEntryStatus.Submitted },
          member,
        ),
      ).resolves.toBe(undefined);
    });
  });

  describe('editing and deleting', () => {
    it('nobody but Admin and HR edits or deletes another user’s entry', async () => {
      for (const actor of [otherMember, manager]) {
        await expect(
          service.validateUpdate(entry(), { minutes: 30 }, actor),
        ).rejects.toThrow(
          new ForbiddenException('You cannot edit this time entry'),
        );
        await expect(service.validateDelete(entry(), actor)).rejects.toThrow(
          new ForbiddenException('You cannot delete this time entry'),
        );
      }
    });

    it.each([TimeEntryStatus.Submitted, TimeEntryStatus.Approved])(
      'the owner can no longer change a %s entry',
      async (status) => {
        const label = status.charAt(0).toUpperCase() + status.slice(1);

        await expect(
          service.validateUpdate(entry({ status }), { minutes: 30 }, member),
        ).rejects.toThrow(
          new ForbiddenException(`${label} time entries cannot be edited`),
        );
        await expect(
          service.validateDelete(entry({ status }), member),
        ).rejects.toThrow(
          new ForbiddenException(`${label} time entries cannot be deleted`),
        );
      },
    );

    it.each([TimeEntryStatus.Draft, TimeEntryStatus.Rejected])(
      'the owner changes and deletes a %s entry',
      async (status) => {
        await expect(
          service.validateUpdate(entry({ status }), { minutes: 30 }, member),
        ).resolves.toBe(undefined);
        await expect(
          service.validateDelete(entry({ status }), member),
        ).resolves.toBeUndefined();
      },
    );

    it.each([hr, admin])(
      '$role changes and deletes anyone’s submitted or approved entry',
      async (actor) => {
        for (const status of [
          TimeEntryStatus.Submitted,
          TimeEntryStatus.Approved,
        ]) {
          await expect(
            service.validateUpdate(
              entry({ status }),
              { minutes: 30, status: TimeEntryStatus.Draft },
              actor,
            ),
          ).resolves.toBe(undefined);
          await expect(
            service.validateDelete(entry({ status }), actor),
          ).resolves.toBeUndefined();
        }
      },
    );
  });

  describe('at most 24 hours per user, project and day', () => {
    it('counts the user’s other entries of that project and day', async () => {
      repository.findMany.mockResolvedValue([{ id: 'a', minutes: 23 * 60 }]);

      await expect(create(member, { minutes: 60 })).resolves.toBe(undefined);
      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: member.id,
        project_id: PROJECT_ID,
        work_date: WORK_DATE.toISOString(),
        slack_team_id: SLACK_TEAM_ID,
        deleted_at: { operator: 'is', value: null },
      });

      await expect(create(member, { minutes: 75 })).rejects.toThrow(
        new ValidationError(
          'Total logged time for this project and date cannot exceed 24 hours',
          'minutes',
        ),
      );
    });

    it('leaves the entry being updated out of the total', async () => {
      repository.findMany.mockResolvedValue([
        { id: 'entry-1', minutes: 8 * 60 },
        { id: 'other', minutes: 15 * 60 },
      ]);

      await expect(
        service.validateUpdate(entry(), { minutes: 9 * 60 }, member),
      ).resolves.toBe(undefined);
      await expect(
        service.validateUpdate(entry(), { minutes: 9 * 60 + 15 }, member),
      ).rejects.toThrow(ValidationError);
    });

    it('checks the day and project the entry moves to, with its current minutes', async () => {
      repository.findMany.mockResolvedValue([{ id: 'other', minutes: 1400 }]);
      const nextDay = new Date('2026-06-18');

      await expect(
        service.validateUpdate(
          entry({ minutes: 60 }),
          { workDate: nextDay, projectId: 'project-2' },
          member,
        ),
      ).rejects.toThrow(ValidationError);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 'project-2',
          work_date: nextDay.toISOString(),
        }),
      );
    });

    it('does not count anything when only the status changes', async () => {
      await service.validateUpdate(
        entry(),
        { status: TimeEntryStatus.Submitted },
        member,
      );

      expect(repository.findMany).not.toHaveBeenCalled();
    });
  });
});
