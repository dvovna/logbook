import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab } from './support/app-home';
import { dmOf } from './support/team-file';
import {
  BALANCES_TEMPLATE_HEADER,
  csvLines,
  HISTORY_TEMPLATE_HEADER,
} from './support/leave-file';

describe('Leave file', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  const expectTemplatesTo = async (
    user: Tables<'users'>,
    since: number,
    balanceLines: string[],
  ) => {
    const files = t.slackApi.uploadedFiles(workspace.token, dmOf(user), {
      since,
    });

    expect(files.map(({ filename }) => filename)).toEqual([
      'leave-balances.csv',
      'leave-history.csv',
    ]);
    expect(csvLines(files[0].content)).toEqual([
      BALANCES_TEMPLATE_HEADER,
      ...balanceLines,
    ]);
    expect(csvLines(files[1].content)).toEqual([HISTORY_TEMPLATE_HEADER]);
  };

  it('HR gets both templates from People', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const team = await workspace.addTeam({ name: 'Backend' });
    const ann = await workspace.addUser({
      name: 'Ann Ames',
      team_id: team.id,
      contract_start_date: '2024-03-01',
    });
    const home = await openAppHomeTab(t, workspace, hr, [
      NavigationActionId.People,
    ]);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, hr, home, UsersTabViewActionId.ImportLeave)
      .expect(200);
    await t.idle();

    await expectTemplatesTo(hr, since, [
      `Ann Ames,${ann.email},2024-03-01,2026-06-17,,,`,
      `Hana HR,${hr.email},,2026-06-17,,,`,
    ]);
  });

  it('an admin gets them from the checklist', async () => {
    const admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
    const home = await openAppHomeTab(t, workspace, admin);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, admin, home, UsersTabViewActionId.ImportLeave)
      .expect(200);
    await t.idle();

    await expectTemplatesTo(admin, since, [
      `Ann Admin,${admin.email},,2026-06-17,,,`,
    ]);
  });

  it('a manager clicking Import leave gets nothing', async () => {
    const manager = await workspace.addUser({ role: UserRole.Manager });
    const home = await openAppHomeTab(t, workspace, manager);
    const since = t.slackApi.mark();

    // The button is not on a manager's Home, but Slack takes ids from the
    // client.
    await t.slack
      .interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: manager.slack_id },
        trigger_id: 'trigger-forged',
        container: { type: 'view' },
        view: { team_id: workspace.slackId, ...home },
        actions: [
          {
            type: 'button',
            action_id: UsersTabViewActionId.ImportLeave,
            block_id: 'forged',
          },
        ],
      })
      .expect(200);
    await t.idle();

    expect(
      t.slackApi.uploadedFiles(workspace.token, dmOf(manager), { since }),
    ).toEqual([]);
    expect(t.slackApi.calls.slice(since)).toEqual([]);
  });
});
