import { ForbiddenException } from '@nestjs/common';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';

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
