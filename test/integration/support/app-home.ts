import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';
import { acknowledged } from './slack-test-client';
import { actionIdsOf } from './tab-readers';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';

// The App Home view the app publishes for `user` after the mark `since`
// (t.slackApi.mark()), e.g. the tab it re-renders after a modal submit.
export const publishedHome = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  since: number,
): Promise<View> => {
  await t.idle();

  return t.slackApi.homeView(workspace.token, user.slack_id, { since });
};

// Clicks or chooses `value` in an element of the App Home `view` and returns
// the view the app publishes in response.
export const actOnTab = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  view: View,
  actionId: string,
  value?: string,
): Promise<View> => {
  const since = t.slackApi.mark();

  await t.slack.actOnView(workspace, user, view, actionId, value).expect(200);

  return publishedHome(t, workspace, user, since);
};

// Opens the screen of the navigation action `actionId` from `view` the way
// a user does: with its button, or by choosing it in the More menu.
export const navigate = (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  view: View,
  actionId: string,
): Promise<View> =>
  actionIdsOf(view).includes(actionId)
    ? actOnTab(t, workspace, user, view, actionId)
    : actOnTab(t, workspace, user, view, NavigationActionId.Menu, actionId);

// Opens the App Home as `user`, then opens the screens in `path` (the
// navigation actions of their buttons or menu options) one after another.
// Returns the view of the last tab.
export const openAppHomeTab = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  path: string[] = [],
): Promise<View> => {
  const since = t.slackApi.mark();

  await t.slack
    .event(workspace, {
      type: 'app_home_opened',
      user: user.slack_id,
      tab: 'home',
    })
    .expect(acknowledged);

  let view = await publishedHome(t, workspace, user, since);

  for (const actionId of path) {
    view = await navigate(t, workspace, user, view, actionId);
  }

  return view;
};

// Clicks or chooses `value` in an element of `view` and returns the modal
// the app opens in response, as the app left it once its work was done.
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

  await t.idle();

  return t.slackApi.shownModal(workspace.token, { since });
};
