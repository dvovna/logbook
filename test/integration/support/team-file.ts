import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { IPostedMessage } from './fake-slack-api.client';
import { acknowledged } from './slack-test-client';
import { sectionTexts } from './tab-readers';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';

// The DM channel of a user, as Slack answers a message to their user ID.
export const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

export const teamFileCsv = (...lines: string[]) =>
  ['Name,Email,Team,Team lead', ...lines].join('\n');

// Shares the file in the DM with the app and returns what the app posted
// back to the sharer.
export const shareTeamFile = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  content: string,
  fileName = 'team-setup.csv',
) => {
  const since = t.slackApi.mark();

  await t.slack
    .event(workspace, {
      type: 'file_shared',
      file_id: t.slackApi.addFile(fileName, content),
      user_id: user.slack_id,
      channel_id: dmOf(user),
    })
    .expect(acknowledged);
  await t.idle();

  return t.slackApi.postedMessages(workspace.token, user.slack_id, { since });
};

// Clicks `actionId` in the message and returns what the app last updated
// the message to.
export const clickInMessage = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  message: IPostedMessage,
  actionId: string,
) => {
  await t.slack.actOnMessage(workspace, user, message, actionId).expect(200);
  await t.idle();

  return t.slackApi.messageUpdates(workspace.token, message).pop() as
    IPostedMessage | undefined;
};

export const messageTexts = (message?: { blocks?: unknown[] }) =>
  sectionTexts(message as unknown as View);

// The workspace's teams and people, to check that nothing changed.
export const workspaceState = async (workspace: TestWorkspace) => ({
  teams: await workspace.rows('teams'),
  users: await workspace.rows('users'),
});
