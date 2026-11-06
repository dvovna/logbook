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

    service = new VacationRequestProcessingService(
      teamsService as unknown as TeamsService,
      workflowService as unknown as RequestWorkflowService,
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
