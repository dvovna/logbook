import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { TeamModalActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';

// Chooses the rules of a team form; the app rebuilds the form in place and
// this returns the rebuilt one.
export const chooseTeamRules = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  form: View,
  rules: TeamRulesChoice,
): Promise<View> => {
  const since = t.slackApi.mark();

  await t.slack
    .actOnView(workspace, user, form, TeamModalActionId.Rules, rules)
    .expect(200);
  await t.idle();

  return t.slackApi.updatedModal(workspace.token, { since });
};
