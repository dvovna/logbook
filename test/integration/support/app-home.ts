import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';
import { acknowledged } from './slack-test-client';
import { eventually } from './eventually';

// Opens the App Home as `user`, then clicks the navigation buttons in `path`
// (their action_ids) one after another. Returns the view of the last tab.
export const openAppHomeTab = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  path: string[] = [],
): Promise<View> => {
  const published = (since: number) =>
    eventually(() =>
      t.slackApi.homeView(workspace.token, user.slack_id, { since }),
    );

  let since = t.slackApi.mark();

  await t.slack
    .event(workspace, {
      type: 'app_home_opened',
      user: user.slack_id,
      tab: 'home',
    })
    .expect(acknowledged);

  let view = await published(since);

  for (const actionId of path) {
    since = t.slackApi.mark();
    await t.slack.actOnView(workspace, user, view, actionId).expect(200);
    view = await published(since);
  }

  return view;
};

// Clicks or chooses `value` in an element of `view` and returns the modal
// the app opens in response.
export const openModalFrom = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  view: View,
  actionId: string,
  value?: string,
): Promise<View> => {
  const since = t.slackApi.mark();

  await t.slack.actOnView(workspace, user, view, actionId, value).expect(200);

  return eventually(() => t.slackApi.openedModal(workspace.token, { since }));
};
