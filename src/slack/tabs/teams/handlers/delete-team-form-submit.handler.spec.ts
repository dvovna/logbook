import { DeleteTeamFormSubmitHandler } from 'src/slack/tabs/teams/handlers/delete-team-form-submit.handler';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import TeamsService from 'src/teams/services/teams.service';
import { UsersService } from 'src/users/services/users.service';
import { TeamsTabService } from 'src/slack/tabs/teams/services/teams-tab.service';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { ISlackViewSubmissionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';

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

const payload = {
  view: {
    private_metadata: JSON.stringify({ id: 'team-1', pageMetadata: '{}' }),
    state: { values: {} },
  },
} as unknown as ISlackViewSubmissionPayload;

describe('DeleteTeamFormSubmitHandler', () => {
  let teamsService: { delete: jest.Mock };
  let usersService: { count: jest.Mock };
  let teamsTabService: { getModalView: jest.Mock };
  let handler: DeleteTeamFormSubmitHandler;

  beforeEach(() => {
    teamsService = {
      delete: jest.fn().mockResolvedValue({ id: 'team-1', name: 'Core' }),
    };
    usersService = { count: jest.fn().mockResolvedValue(0) };
    teamsTabService = {
      getModalView: jest.fn().mockResolvedValue({ type: 'modal' }),
    };

    handler = new DeleteTeamFormSubmitHandler(
      new ConfirmationModalView(),
      teamsService as unknown as TeamsService,
      usersService as unknown as UsersService,
      teamsTabService as unknown as TeamsTabService,
      { navigate: jest.fn() } as unknown as TabNavigationService,
    );
  });

  it('deletes a team without active members', async () => {
    await handler.handle(payload, admin);

    expect(usersService.count).toHaveBeenCalledWith({
      slackTeamId: admin.slack_team_id,
      teamId: 'team-1',
      isActive: true,
    });
    expect(teamsService.delete).toHaveBeenCalledWith('team-1', admin);
  });

  it('refuses to delete a team that still has members', async () => {
    usersService.count.mockResolvedValue(3);

    await handler.handle(payload, admin);

    expect(teamsService.delete).not.toHaveBeenCalled();
    expect(teamsTabService.getModalView).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorMessage:
          'This team has dependencies (3 active members) and cannot be deleted.',
      }),
    );
  });
});
