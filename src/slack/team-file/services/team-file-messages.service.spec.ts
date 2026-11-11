import UserRole from '@common/enums/user-role.enum';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_id: 'UHR',
  slack_team_id: 'workspace-1',
} as IUserViewModel;

describe('TeamFileMessagesService', () => {
  it('tells the clicker that nothing changed when Apply fails, and lets the error be logged', async () => {
    const failure = new Error('connection lost');
    const slack = {
      postEphemeral: jest.fn(),
      updateMessage: jest.fn(),
    };
    const service = new TeamFileMessagesService(
      slack as unknown as SlackCommunicationService,
      {
        apply: jest.fn().mockRejectedValue(failure),
      } as unknown as TeamFileUploadsService,
      {} as CompanyRulesService,
      new TeamFileMessageView(),
    );

    await expect(service.apply('upload-1', hr)).rejects.toBe(failure);
    expect(slack.postEphemeral).toHaveBeenCalledWith(
      'UHR',
      { text: "The file couldn't be applied, so nothing changed. Try again." },
      'workspace-1',
    );
    expect(slack.updateMessage).not.toHaveBeenCalled();
  });
});
