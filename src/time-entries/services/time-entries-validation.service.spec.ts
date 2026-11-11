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

const entryParams = {
  userId: member.id,
  projectId: PROJECT_ID,
  workDate: WORK_DATE,
  minutes: 60,
  status: TimeEntryStatus.Draft,
};

describe('TimeEntriesValidationService', () => {
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
    overrides: Partial<typeof entryParams & { description: string }> = {},
  ) =>
    service.checkCreate(
      { ...entryParams, userId: actor.id, ...overrides },
      actor,
    );

  describe('minutes', () => {
    it.each([
      [0, 'Logged minutes must be greater than 0'],
      [-15, 'Logged minutes must be greater than 0'],
      [24 * 60 + 15, 'Logged minutes cannot exceed 1440'],
      [20, 'Logged minutes must be in 15 - minute increments'],
    ])('rejects %i minutes at the minutes field', (minutes, message) => {
      expect(() => create(member, { minutes })).toThrow(
        new ValidationError(message, 'minutes'),
      );
      expect(() =>
        service.checkUpdate(entry(), { minutes }, member, false),
      ).toThrow(new ValidationError(message, 'minutes'));
    });

    it('accepts a whole day in 15-minute steps', () => {
      expect(() => create(member, { minutes: 24 * 60 })).not.toThrow();
    });
  });

  describe('a description over 200 characters', () => {
    const description = 'x'.repeat(201);

    it('is refused on create and on edit', () => {
      for (const act of [
        () => create(member, { description }),
        () => service.checkUpdate(entry(), { description }, member, false),
      ]) {
        expect(act).toThrow(ValidationError);
        expect(act).toThrow(expect.objectContaining({ field: 'description' }));
      }
    });
  });

  describe('the status a member creates an entry with', () => {
    it.each([TimeEntryStatus.Draft, TimeEntryStatus.Submitted])(
      'may be %s',
      (status) => {
        expect(() => create(member, { status })).not.toThrow();
      },
    );

    it.each([TimeEntryStatus.Rejected, TimeEntryStatus.Cancelled])(
      'may not be %s',
      (status) => {
        expect(() => create(member, { status })).toThrow(ForbiddenException);
      },
    );
  });

  describe('logging time for someone else', () => {
    it.each([member, manager])('is forbidden to a $role', (actor) => {
      expect(() => create(actor, { userId: otherMember.id })).toThrow(
        new ForbiddenException('You cannot log time for another user'),
      );
    });

    it.each([hr, admin])('is allowed to $role', (actor) => {
      expect(() => create(actor, { userId: member.id })).not.toThrow();
    });
  });

  describe('approved entries', () => {
    it.each([member, manager])('a $role cannot create one', (actor) => {
      expect(() => create(actor, { status: TimeEntryStatus.Approved })).toThrow(
        new ForbiddenException('Only admins can create approved entries'),
      );
    });

    it.each([hr, admin])('$role can create one', (actor) => {
      expect(() =>
        create(actor, { status: TimeEntryStatus.Approved }),
      ).not.toThrow();
    });

    it('the owner cannot approve their own entry by updating its status', () => {
      expect(() =>
        service.checkUpdate(
          entry(),
          { status: TimeEntryStatus.Approved },
          member,
          false,
        ),
      ).toThrow(new ForbiddenException('Only admins can approve entries'));
    });

    it('the owner may submit a draft', () => {
      expect(() =>
        service.checkUpdate(
          entry(),
          { status: TimeEntryStatus.Submitted },
          member,
          false,
        ),
      ).not.toThrow();
    });
  });

  describe('editing and deleting', () => {
    it('nobody but Admin and HR edits or deletes another user’s entry', () => {
      for (const actor of [otherMember, manager]) {
        expect(() =>
          service.checkUpdate(entry(), { minutes: 30 }, actor, false),
        ).toThrow(new ForbiddenException('You cannot edit this time entry'));
        expect(() => service.checkDelete(entry(), actor, false)).toThrow(
          new ForbiddenException('You cannot delete this time entry'),
        );
      }
    });

    it.each([TimeEntryStatus.Submitted, TimeEntryStatus.Approved])(
      'the owner can no longer change a %s entry',
      (status) => {
        const label = status.charAt(0).toUpperCase() + status.slice(1);

        expect(() =>
          service.checkUpdate(
            entry({ status }),
            { minutes: 30 },
            member,
            false,
          ),
        ).toThrow(
          new ForbiddenException(`${label} time entries cannot be edited`),
        );
        expect(() =>
          service.checkDelete(entry({ status }), member, false),
        ).toThrow(
          new ForbiddenException(`${label} time entries cannot be deleted`),
        );
      },
    );

    it.each([TimeEntryStatus.Draft, TimeEntryStatus.Rejected])(
      'the owner changes and deletes a %s entry',
      (status) => {
        expect(() =>
          service.checkUpdate(
            entry({ status }),
            { minutes: 30 },
            member,
            false,
          ),
        ).not.toThrow();
        expect(() =>
          service.checkDelete(entry({ status }), member, false),
        ).not.toThrow();
      },
    );

    it.each([hr, admin])(
      '$role changes and deletes anyone’s submitted or approved entry',
      (actor) => {
        for (const status of [
          TimeEntryStatus.Submitted,
          TimeEntryStatus.Approved,
        ]) {
          expect(() =>
            service.checkUpdate(
              entry({ status }),
              { minutes: 30, status: TimeEntryStatus.Draft },
              actor,
              false,
            ),
          ).not.toThrow();
          expect(() =>
            service.checkDelete(entry({ status }), actor, false),
          ).not.toThrow();
        }
      },
    );
  });

  describe('an entry in a billing snapshot', () => {
    const approved = entry({
      user_id: 'owner',
      status: TimeEntryStatus.Approved,
    });

    it.each([admin, hr])('is not edited or un-approved by $role', (actor) => {
      for (const update of [
        { minutes: 30 },
        { status: TimeEntryStatus.Draft },
        { description: 'Fixed' },
      ]) {
        expect(() =>
          service.checkUpdate(approved, update, actor, true),
        ).toThrow(new ValidationError(BILLED_ENTRY_MESSAGE));
      }
    });

    it('is not deleted, by an admin either', () => {
      expect(() => service.checkDelete(approved, admin, true)).toThrow(
        new ValidationError(BILLED_ENTRY_MESSAGE),
      );
    });

    it("tells its owner first that approved entries don't change", () => {
      expect(() =>
        service.checkDelete(approved, user('owner', UserRole.Member), true),
      ).toThrow(ForbiddenException);
    });

    it('lets an admin change an approved entry that no snapshot holds', () => {
      expect(() =>
        service.checkUpdate(approved, { minutes: 30 }, admin, false),
      ).not.toThrow();
      expect(() => service.checkDelete(approved, hr, false)).not.toThrow();
    });
  });

  describe('at most 24 hours per user, project and day', () => {
    it('adds the new minutes to the logged ones', () => {
      expect(() => service.checkDailyTotal(23 * 60, 60)).not.toThrow();
      expect(() => service.checkDailyTotal(23 * 60, 75)).toThrow(
        new ValidationError(
          'Total logged time for this project and date cannot exceed 24 hours',
          'minutes',
        ),
      );
    });
  });

  describe('validateCreate', () => {
    it('checks the entry, then the user’s time on its project and day', async () => {
      repository.findMany.mockResolvedValue([{ id: 'a', minutes: 23 * 60 }]);

      await expect(
        service.validateCreate(entryParams, member),
      ).resolves.toBeUndefined();
      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: member.id,
        project_id: PROJECT_ID,
        work_date: WORK_DATE.toISOString(),
        slack_team_id: SLACK_TEAM_ID,
        deleted_at: { operator: 'is', value: null },
      });

      await expect(
        service.validateCreate({ ...entryParams, minutes: 75 }, member),
      ).rejects.toThrow(ValidationError);
    });

    it('reads nothing for an entry the checks refuse', async () => {
      await expect(
        service.validateCreate(
          { ...entryParams, userId: otherMember.id },
          member,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findMany).not.toHaveBeenCalled();
    });
  });

  describe('validateUpdate', () => {
    it('reads whether the entry is billed and refuses it', async () => {
      repository.findBilledIds.mockResolvedValue(new Set(['entry-1']));

      await expect(
        service.validateUpdate(entry(), { description: 'Fixed' }, member),
      ).rejects.toThrow(new ValidationError(BILLED_ENTRY_MESSAGE));
      expect(repository.findBilledIds).toHaveBeenCalledWith(SLACK_TEAM_ID, [
        'entry-1',
      ]);
    });

    it('leaves the entry being updated out of the day’s total', async () => {
      repository.findMany.mockResolvedValue([
        { id: 'entry-1', minutes: 8 * 60 },
        { id: 'other', minutes: 15 * 60 },
      ]);

      await expect(
        service.validateUpdate(entry(), { minutes: 9 * 60 }, member),
      ).resolves.toBeUndefined();
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

    it('reads nothing for someone who may not edit the entry', async () => {
      await expect(
        service.validateUpdate(entry(), { minutes: 60 }, otherMember),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findBilledIds).not.toHaveBeenCalled();
      expect(repository.findMany).not.toHaveBeenCalled();
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

  describe('validateDelete', () => {
    it('reads whether the entry is billed and refuses it, an admin too', async () => {
      repository.findBilledIds.mockResolvedValue(new Set(['entry-1']));

      await expect(service.validateDelete(entry(), admin)).rejects.toThrow(
        new ValidationError(BILLED_ENTRY_MESSAGE),
      );
      await expect(
        service.validateDelete(entry(), otherMember),
      ).rejects.toThrow(ForbiddenException);
    });

    it('passes an entry that is not billed', async () => {
      await expect(
        service.validateDelete(entry(), member),
      ).resolves.toBeUndefined();
    });

    it('reads nothing for someone who may not delete the entry', async () => {
      await expect(
        service.validateDelete(entry(), otherMember),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findBilledIds).not.toHaveBeenCalled();
    });
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
