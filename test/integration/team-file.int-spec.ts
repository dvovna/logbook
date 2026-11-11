import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab } from './support/app-home';

// The DM channel of a user, as Slack answers a message to their user ID.
const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

describe('Team file', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  it('HR gets the team file in a DM from Teams', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const backend = await workspace.addTeam({
      name: 'Backend',
      manager_approvers: ['ULEAD'],
    });
    const lead = await workspace.addUser({
      slack_id: 'ULEAD',
      name: 'Lee Lead',
      team_id: backend.id,
    });
    const home = await openAppHomeTab(t, workspace, hr, [
      NavigationActionId.Teams,
    ]);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, hr, home, TeamsTabViewActionId.TeamFile)
      .expect(200);
    await t.idle();

    const [file] = t.slackApi.uploadedFiles(workspace.token, dmOf(hr), {
      since,
    });

    expect(file.filename).toBe('team-setup.csv');
    expect(
      file.content.replace('\uFEFF', '').replace(/\r\n$/, '').split('\r\n'),
    ).toEqual([
      'Name,Email,Team,Team lead',
      `Lee Lead,${lead.email},Backend,yes`,
      `Hana HR,${hr.email},,`,
    ]);
  });
});
