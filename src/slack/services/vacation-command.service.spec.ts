import { View } from '@slack/types/dist/views';
import VacationCommandService, {
  VacationCommand,
} from 'src/slack/services/vacation-command.service';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { VacationRequestFormModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { CancelVacationRequestSelectModalView } from 'src/slack/tabs/home/views/cancel-vacation-request-select-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

const user: IUserViewModel = {
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

describe('VacationCommandService', () => {
  let slackCommunicationService: Record<
    'postEphemeral' | 'openView',
    jest.Mock
  >;
  let vacationRequestsService: { findMany: jest.Mock };
  let service: VacationCommandService;

  beforeEach(() => {
    slackCommunicationService = {
      postEphemeral: jest.fn(),
      openView: jest.fn(),
    };
    vacationRequestsService = { findMany: jest.fn().mockResolvedValue([]) };

    service = new VacationCommandService(
      {} as VacationsUsageService,
      slackCommunicationService as unknown as SlackCommunicationService,
      {} as VacationRequestFormModalView,
      vacationRequestsService as unknown as VacationRequestsService,
      new CancelVacationRequestSelectModalView(),
    );
  });

  describe('cancel', () => {
    it('tells the user when there is nothing to cancel', async () => {
      await service.handleCommand(VacationCommand.Cancel, user, 'trigger-1');

      expect(vacationRequestsService.findMany).toHaveBeenCalledWith({
        userId: user.id,
        slackTeamId: user.slack_team_id,
        status: VacationRequestStatus.Pending,
      });
      expect(slackCommunicationService.postEphemeral).toHaveBeenCalledWith(
        user.slack_id,
        { text: 'You have no vacation requests waiting for approval.' },
        user.slack_team_id,
      );
      expect(slackCommunicationService.openView).not.toHaveBeenCalled();
    });

    it('opens a modal listing the pending requests', async () => {
      vacationRequestsService.findMany.mockResolvedValue([
        {
          id: 'request-1',
          start_date: '2026-02-02',
          end_date: '2026-02-06',
          days: 5,
          type: VacationType.AnnualLeave,
          status: VacationRequestStatus.Pending,
        },
      ]);

      await service.handleCommand(VacationCommand.Cancel, user, 'trigger-1');

      const [triggerId, view, slackTeamId] = slackCommunicationService.openView
        .mock.calls[0] as [string, View, string];
      const options = JSON.stringify(view.blocks);

      expect(triggerId).toBe('trigger-1');
      expect(slackTeamId).toBe(user.slack_team_id);
      expect(view.callback_id).toBe(
        ViewCallbackId.CancelVacationRequestCommandSubmit,
      );
      expect(options).toContain('"value":"request-1"');
      expect(options).toContain('2026-02-02 – 2026-02-06');
    });
  });

  it('points unknown subcommands to /vacations', async () => {
    await service.handleCommand('oops', user);

    expect(slackCommunicationService.postEphemeral).toHaveBeenCalledWith(
      user.slack_id,
      { text: 'Unknown command. Use `/vacations (usage|request|cancel)`.' },
      user.slack_team_id,
    );
  });
});
