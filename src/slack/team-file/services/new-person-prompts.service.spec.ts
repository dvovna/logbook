import UserRole from '@common/enums/user-role.enum';
import { JobsService } from '@common/jobs/jobs.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { NewPersonPromptsService } from '@modules/slack/team-file/services/new-person-prompts.service';
import { NewPersonPromptView } from '@modules/slack/team-file/views/new-person-prompt.view';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { NewPersonPromptsRepository } from 'src/team-file/repositories/new-person-prompts.repository';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_id: 'UHR',
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('NewPersonPromptsService', () => {
  const build = () => {
    const slack = { postEphemeral: jest.fn() };
    const users = { findOne: jest.fn(), restoreTeams: jest.fn() };
    const teams = { findOne: jest.fn() };
    const prompts = { closeOpen: jest.fn() };
    const service = new NewPersonPromptsService(
      {} as unknown as JobsService,
      slack as unknown as SlackCommunicationService,
      users as unknown as UsersService,
      teams as unknown as TeamsService,
      {} as unknown as CompanyRulesService,
      prompts as unknown as NewPersonPromptsRepository,
      {} as unknown as NewPersonPromptView,
    );

    return { service, slack, users, teams, prompts };
  };

  it.each(['', 'x|y', `${ID}|y`, `x|${ID}`, ID])(
    'answers a choice of %p, which holds no person and team IDs, as no longer open',
    async (value) => {
      const { service, slack, users, teams } = build();

      await service.choose(value, hr);

      expect(slack.postEphemeral).toHaveBeenCalledWith(
        'UHR',
        { text: 'This question is no longer open. Nothing changed.' },
        'workspace-1',
      );
      expect(users.findOne).not.toHaveBeenCalled();
      expect(teams.findOne).not.toHaveBeenCalled();
      expect(users.restoreTeams).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'x', `${ID}x`])(
    'answers Not yet for %p, which is no person ID, as no longer open',
    async (userId) => {
      const { service, slack, users, prompts } = build();

      await service.notYet(userId, hr);

      expect(slack.postEphemeral).toHaveBeenCalledWith(
        'UHR',
        { text: 'This question is no longer open. Nothing changed.' },
        'workspace-1',
      );
      expect(users.findOne).not.toHaveBeenCalled();
      expect(prompts.closeOpen).not.toHaveBeenCalled();
    },
  );
});
