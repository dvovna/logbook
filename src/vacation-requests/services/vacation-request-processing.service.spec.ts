import { VacationRequestProcessingService } from 'src/vacation-requests/services/vacation-request-processing.service';
import TeamsService from 'src/teams/services/teams.service';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from 'src/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { UsersService } from 'src/users/services/users.service';
import UserRole from 'src/common/enums/user-role.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';

const SLACK_TEAM_ID = 'slack-team-1';

const buildRequest = (
  status: VacationRequestStatus,
): IVacationRequestViewModel => ({
  id: 'request-1',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  days: 5,
  working_days: 5,
  type: VacationType.AnnualLeave,
  status,
  team: { id: 'team-1', name: 'Team', slack_id: '' },
  user: {
    id: 'user-1',
    name: 'Requester',
    email: 'requester@example.com',
    slack_id: 'U_REQUESTER',
  },
  team_id: 'team-1',
  user_id: 'user-1',
  slack_team_id: SLACK_TEAM_ID,
  created_at: null,
  updated_at: null,
  updated_by: null,
  created_by: null,
});

describe('VacationRequestProcessingService', () => {
  let teamsService: { findOne: jest.Mock };
  let workflowService: Record<'create' | 'cancel', jest.Mock>;
  let usersByRole: Partial<Record<UserRole, string[]>>;
  let eventEmitter: { emit: jest.Mock };
  let service: VacationRequestProcessingService;

  beforeEach(() => {
    teamsService = {
      findOne: jest.fn().mockResolvedValue({
        id: 'team-1',
        manager_approvers: ['U_MANAGER'],
        manager_approvers_rule: ApprovalRule.Any,
        hr_approvers: [],
        hr_approvers_rule: ApprovalRule.All,
      }),
    };
    workflowService = { create: jest.fn(), cancel: jest.fn() };
    usersByRole = {};
    const usersService = {
      findMany: jest.fn(async ({ role }: { role: UserRole }) =>
        (usersByRole[role] ?? []).map((slack_id) => ({ slack_id })),
      ),
    };
    eventEmitter = { emit: jest.fn() };

    service = new VacationRequestProcessingService(
      teamsService as unknown as TeamsService,
      workflowService as unknown as RequestWorkflowService,
      usersService as unknown as UsersService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  const onCreated = (status: VacationRequestStatus) =>
    service.handleRequestCreated(
      new VacationRequestCreatedEvent(
        buildRequest(status),
        {} as IUserViewModel,
      ),
    );

  it('starts the approval workflow for a pending request', async () => {
    await onCreated(VacationRequestStatus.Pending);

    expect(workflowService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        levels: [
          {
            rule: ApprovalRule.Any,
            steps: [{ slackUserId: 'U_MANAGER', stepType: 'approver' }],
          },
        ],
      }),
    );
  });

  it.each([
    VacationRequestStatus.Approved,
    VacationRequestStatus.Rejected,
    VacationRequestStatus.Canceled,
  ])(
    'does not ask anyone to approve a request created as %s',
    async (status) => {
      await onCreated(status);

      expect(teamsService.findOne).not.toHaveBeenCalled();
      expect(workflowService.create).not.toHaveBeenCalled();
    },
  );

  describe('when nobody on the team can approve it', () => {
    const levelsOf = () => workflowService.create.mock.calls[0][0].levels;
    const sentTo = () => {
      const [event, payload] = eventEmitter.emit.mock.calls[0];
      expect(event).toBe(VacationRequestEvent.WithoutTeamApprovers);
      return payload.sentTo;
    };
    const anyOf = (...slackIds: string[]) => [
      {
        rule: ApprovalRule.Any,
        steps: slackIds.map((slackUserId) => ({
          slackUserId,
          stepType: 'approver',
        })),
      },
    ];

    beforeEach(() => {
      // The requester is the team's only approver.
      teamsService.findOne.mockResolvedValue({
        id: 'team-1',
        manager_approvers: ['U_REQUESTER'],
        manager_approvers_rule: ApprovalRule.All,
        hr_approvers: [],
        hr_approvers_rule: ApprovalRule.All,
      });
    });

    it('sends it to anyone of HR, leaving out the requester', async () => {
      usersByRole = {
        [UserRole.HR]: ['U_HR_1', 'U_REQUESTER', 'U_HR_2'],
        [UserRole.Admin]: ['U_ADMIN'],
      };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('U_HR_1', 'U_HR_2'));
      expect(sentTo()).toBe(UserRole.HR);
    });

    it('sends it to the admins when there is no HR', async () => {
      usersByRole = { [UserRole.Admin]: ['U_ADMIN'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('U_ADMIN'));
      expect(sentTo()).toBe(UserRole.Admin);
    });

    it('does the same for a requester in no team', async () => {
      teamsService.findOne.mockResolvedValue(null);
      usersByRole = { [UserRole.HR]: ['U_HR_1'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('U_HR_1'));
      expect(eventEmitter.emit.mock.calls[0][1].inTeam).toBe(false);
    });

    it('starts no workflow when nobody else can approve it', async () => {
      usersByRole = { [UserRole.Admin]: ['U_REQUESTER'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(workflowService.create).not.toHaveBeenCalled();
      expect(sentTo()).toBeNull();
    });
  });

  it('closes the approval workflow when the request is updated', async () => {
    const requester = { id: 'user-1' } as IUserViewModel;

    await service.handleRequestUpdated(
      new VacationRequestUpdatedEvent(
        buildRequest(VacationRequestStatus.Canceled),
        requester,
      ),
    );

    expect(workflowService.cancel).toHaveBeenCalledWith('request-1', requester);
  });
});
