import { ForbiddenException } from '@nestjs/common';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import TeamsService from 'src/teams/services/teams.service';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';
import { MANAGER_ROLES } from 'src/common/constants/role-groups';
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
      {} as UsersService,
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

describe('TimeEntryApprovalsService scopes and decisions', () => {
  const SLACK_TEAM_ID = 'slack-team-1';

  const user = (role: UserRole) =>
    ({
      id: `${role}-1`,
      slack_id: `U_${role.toUpperCase()}`,
      role,
      slack_team_id: SLACK_TEAM_ID,
    }) as IUserViewModel;

  const member = user(UserRole.Member);
  const manager = user(UserRole.Manager);
  const hr = user(UserRole.HR);
  const workspaceAdmin = user(UserRole.Admin);

  const pendingFilter = (approver: IUserViewModel) => ({
    slack_team_id: SLACK_TEAM_ID,
    status: TimeEntryStatus.Submitted,
    deleted_at: { operator: 'is', value: null },
    user_id: { operator: 'neq', value: approver.id },
  });

  let repository: {
    updateMany: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
    findSubmittedKeys: jest.Mock;
  };
  let listQuery: { execute: jest.Mock };
  let teamsService: { findMany: jest.Mock };
  let usersService: { findMany: jest.Mock };
  let service: TimeEntryApprovalsService;

  beforeEach(() => {
    repository = {
      updateMany: jest.fn().mockResolvedValue([{ id: 'entry-1' }]),
      count: jest.fn().mockResolvedValue(3),
      findMany: jest.fn().mockResolvedValue([]),
      findSubmittedKeys: jest.fn().mockResolvedValue([]),
    };
    listQuery = {
      execute: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };
    teamsService = { findMany: jest.fn().mockResolvedValue([]) };
    usersService = { findMany: jest.fn().mockResolvedValue([]) };

    service = new TimeEntryApprovalsService(
      repository as unknown as TimeEntriesRepository,
      listQuery as unknown as TimeEntriesListQuery,
      teamsService as unknown as TeamsService,
      usersService as unknown as UsersService,
    );
  });

  describe('a member', () => {
    it('has nothing waiting and reads nothing', async () => {
      await expect(
        service.listPending(member, { pageSize: 10 }),
      ).resolves.toEqual({ items: [], totalCount: 0 });
      await expect(service.countPending(member)).resolves.toBe(0);
      expect(listQuery.execute).not.toHaveBeenCalled();
      expect(repository.count).not.toHaveBeenCalled();
    });

    it('cannot approve or reject, even with an entry id', async () => {
      const forbidden = new ForbiddenException(
        'You cannot approve time entries',
      );

      await expect(service.approve(member, 'entry-1')).rejects.toThrow(
        forbidden,
      );
      await expect(service.approve(member)).rejects.toThrow(forbidden);
      await expect(service.reject(member, 'entry-1')).rejects.toThrow(
        forbidden,
      );
      expect(repository.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('a manager', () => {
    it('decides only on the entries of the teams that list them as manager approver', async () => {
      teamsService.findMany.mockResolvedValue([
        { id: 'team-1' },
        { id: 'team-2' },
      ]);

      await service.approve(manager, 'entry-1');

      expect(teamsService.findMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        managerApprovers: [manager.slack_id],
      });
      expect(repository.updateMany).toHaveBeenCalledWith(
        {
          ...pendingFilter(manager),
          team_id: { operator: 'in', value: ['team-1', 'team-2'] },
          id: 'entry-1',
        },
        expect.objectContaining({ status: TimeEntryStatus.Approved }),
      );
    });

    it('of no team matches no entry rather than every entry', async () => {
      await service.approve(manager);
      await service.countPending(manager);
      await service.listPending(manager, { pageSize: 10 });

      const noTeams = { operator: 'in', value: [] };
      expect(repository.updateMany.mock.calls[0][0].team_id).toEqual(noTeams);
      expect(repository.count.mock.calls[0][0].team_id).toEqual(noTeams);
      expect(listQuery.execute).toHaveBeenCalledWith(
        expect.objectContaining({ teamIds: [] }),
      );
    });
  });

  describe.each([workspaceAdmin, hr])('$role', (approver) => {
    it('decides on any team’s entry by its id, but not on their own', async () => {
      await service.approve(approver, 'entry-1');

      expect(teamsService.findMany).not.toHaveBeenCalled();
      expect(repository.updateMany).toHaveBeenCalledWith(
        { ...pendingFilter(approver), id: 'entry-1' },
        expect.objectContaining({ status: TimeEntryStatus.Approved }),
      );
    });

    it('lists every submitted entry of others when asked for all', async () => {
      await service.listPending(approver, { page: 2, pageSize: 10, all: true });

      expect(listQuery.execute).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        page: 2,
        pageSize: 10,
        status: TimeEntryStatus.Submitted,
        teamIds: undefined,
        excludeUserId: approver.id,
      });
    });
  });

  // What waits for Admin and HR: the entries no manager of their team
  // decides. Those go to HR, and to the admins only when there is no HR.
  describe('what waits for Admin and HR', () => {
    beforeEach(() => {
      repository.findSubmittedKeys.mockResolvedValue([
        { id: 'with-manager', team_id: 'team-1', user_id: member.id },
        { id: 'no-team', team_id: null, user_id: member.id },
        // The team's only manager can't approve their own entry.
        { id: 'managers-own', team_id: 'team-1', user_id: manager.id },
      ]);
      teamsService.findMany.mockResolvedValue([
        { id: 'team-1', manager_approvers: [manager.slack_id] },
      ]);
      usersService.findMany.mockResolvedValue([manager, hr, workspaceAdmin]);
      repository.updateMany.mockResolvedValue([]);
    });

    it('is what no manager decides, for HR', async () => {
      await expect(service.countPending(hr)).resolves.toBe(2);

      await service.approve(hr);

      expect(repository.findSubmittedKeys).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        hr.id,
      );
      expect(usersService.findMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        roles: [...MANAGER_ROLES],
      });
      expect(repository.updateMany).toHaveBeenCalledWith(
        {
          ...pendingFilter(hr),
          id: { operator: 'in', value: ['no-team', 'managers-own'] },
        },
        expect.objectContaining({ status: TimeEntryStatus.Approved }),
      );
    });

    it('is nothing for an admin while there is HR', async () => {
      await expect(service.countPending(workspaceAdmin)).resolves.toBe(0);

      await expect(service.approve(workspaceAdmin)).resolves.toEqual([]);
      expect(repository.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ id: { operator: 'in', value: [] } }),
        expect.anything(),
      );
    });

    it('goes to the admins when there is no HR', async () => {
      usersService.findMany.mockResolvedValue([manager, workspaceAdmin]);

      await expect(service.countPending(workspaceAdmin)).resolves.toBe(2);
    });
  });

  describe('the decision', () => {
    it('keeps a trimmed rejection reason for the owner', async () => {
      await service.reject(workspaceAdmin, 'entry-1', '  Wrong project  ');

      expect(repository.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'entry-1' }),
        expect.objectContaining({
          status: TimeEntryStatus.Rejected,
          rejection_reason: 'Wrong project',
          updated_by: workspaceAdmin.id,
        }),
      );
    });

    it('stores no reason for a blank rejection or an approval', async () => {
      await service.reject(workspaceAdmin, 'entry-1', '   ');
      await service.approve(workspaceAdmin, 'entry-1');

      expect(
        repository.updateMany.mock.calls[0][1].rejection_reason,
      ).toBeNull();
      expect(
        repository.updateMany.mock.calls[1][1].rejection_reason,
      ).toBeNull();
    });

    it('fails for an entry that is no longer waiting (decided, withdrawn or out of scope)', async () => {
      repository.updateMany.mockResolvedValue([]);

      await expect(service.approve(workspaceAdmin, 'entry-1')).rejects.toThrow(
        new ValidationError(
          'This time entry is no longer waiting for your approval.',
        ),
      );
      await expect(service.reject(workspaceAdmin, 'entry-1')).rejects.toThrow(
        ValidationError,
      );
    });

    it('approving all with nothing waiting is not an error', async () => {
      repository.updateMany.mockResolvedValue([]);

      await expect(service.approve(workspaceAdmin)).resolves.toEqual([]);
    });
  });
});
