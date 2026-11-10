import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import TeamsService from 'src/teams/services/teams.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';

const admin: IUserViewModel = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.Admin,
  is_active: true,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U_ADMIN',
  created_at: '2026-01-01T00:00:00Z',
};

describe('TimeEntryApprovalsService', () => {
  let repository: Record<'updateMany', jest.Mock>;
  let service: TimeEntryApprovalsService;

  beforeEach(() => {
    repository = { updateMany: jest.fn().mockResolvedValue([]) };
    service = new TimeEntryApprovalsService(
      repository as unknown as TimeEntriesRepository,
      {} as TimeEntriesListQuery,
      {} as TeamsService,
    );
  });

  // The database keeps at most 300 characters of a rejection reason.
  it('refuses a rejection reason over 300 characters', async () => {
    const error: unknown = await service
      .reject(admin, 'entry-1', 'x'.repeat(301))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: 'reason' });
    expect(repository.updateMany).not.toHaveBeenCalled();
  });
});
