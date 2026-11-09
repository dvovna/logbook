import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  TeamModalActionId,
  TeamsTabViewActionId,
} from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { actionIdsOf, sectionTexts } from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';

const CHECKLIST = '*🚀 Set up Logbook*';

// What an admin sees until the workspace is set up, and the team form's
// members.
describe('First setup', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
  });

  const checklistOf = async (user: Tables<'users'>) => {
    const home = await openAppHomeTab(t, workspace, user);

    return {
      text: sectionTexts(home).find((text) => text.startsWith(CHECKLIST)),
      actions: actionIdsOf(home),
    };
  };

  describe('the checklist on Home', () => {
    it('shows an admin what is left, with the screens that do it', async () => {
      await workspace.addUser({ name: 'Mo Member' });

      const { text, actions } = await checklistOf(admin);

      expect(text).toBe(
        [
          CHECKLIST,
          '⬜ Create a vacation policy: days per year and holidays',
          '⬜ Create a team and pick its approvers',
          '⬜ Put people in teams (2 people without a team)',
          '⬜ Add projects, if you track time',
        ].join('\n'),
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          NavigationActionId.Policies,
          NavigationActionId.Teams,
          NavigationActionId.People,
          NavigationActionId.Projects,
        ]),
      );
    });

    it('ticks what is done and goes once everyone is in a team with approvers', async () => {
      const policy = await workspace.addVacationPolicy();
      const team = await workspace.addTeam({
        vacation_policy_id: policy.id,
        manager_approvers: [admin.slack_id],
      });
      const member = await workspace.addUser({ name: 'Mo Member' });

      expect((await checklistOf(admin)).text).toBe(
        [
          CHECKLIST,
          '✅ Create a vacation policy: days per year and holidays',
          '✅ Create a team and pick its approvers',
          '⬜ Put people in teams (2 people without a team)',
          '⬜ Add projects, if you track time',
        ].join('\n'),
      );

      await t.db
        .from('users')
        .update({ team_id: team.id })
        .in('id', [admin.id, member.id]);

      expect((await checklistOf(admin)).text).toBeUndefined();
    });

    it('is only for Admin and HR', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });

      expect((await checklistOf(manager)).text).toBeUndefined();
    });
  });

  it('offers to create the first team in the empty list', async () => {
    const teamsTab = await openAppHomeTab(t, workspace, admin, [
      NavigationActionId.Settings,
      NavigationActionId.Teams,
    ]);
    expect(sectionTexts(teamsTab)).toContain(
      "_No teams yet._ A team's approvers decide its people's time off, under its vacation policy.",
    );

    const form = await openModalFrom(
      t,
      workspace,
      admin,
      teamsTab,
      TeamsTabViewActionId.AddTeam,
    );
    expect(form.callback_id).toBe(ViewCallbackId.TeamFormSubmit);
  });

  describe("the team form's members", () => {
    const openTeamForm = async (teamId?: string) => {
      const teamsTab = await openAppHomeTab(t, workspace, admin, [
        NavigationActionId.Settings,
        NavigationActionId.Teams,
      ]);

      return teamId
        ? openModalFrom(
            t,
            workspace,
            admin,
            teamsTab,
            TeamsTabViewActionId.ManageTeamMenu,
            `${TeamsTabViewActionId.EditTeam}:${teamId}`,
          )
        : openModalFrom(
            t,
            workspace,
            admin,
            teamsTab,
            TeamsTabViewActionId.AddTeam,
          );
    };

    const teamOf = async (user: Tables<'users'>) =>
      (await workspace.row('users', user.id)).team_id;

    it('puts the chosen people in a new team, moving them from another one', async () => {
      const other = await workspace.addTeam({ name: 'Ops' });
      const ada = await workspace.addUser({ name: 'Ada Lovelace' });
      const bob = await workspace.addUser({
        name: 'Bob Moved',
        team_id: other.id,
      });

      const suggestions = await t.slack
        .suggest(
          workspace,
          admin,
          await openTeamForm(),
          TeamModalActionId.Members,
          'ada',
        )
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Ada Lovelace' }, value: ada.id },
      ]);

      await t.slack
        .submitView(workspace, admin, await openTeamForm(), {
          name: 'Design',
          [TeamModalActionId.Members]: [ada.id, bob.id],
        })
        .expect(200);

      const [design] = (await workspace.rows('teams')).filter(
        ({ name }) => name === 'Design',
      );
      expect(await teamOf(ada)).toBe(design.id);
      expect(await teamOf(bob)).toBe(design.id);
    });

    it('takes out the members no longer chosen, and nobody of another workspace', async () => {
      const team = await workspace.addTeam({ name: 'Design' });
      const ada = await workspace.addUser({
        name: 'Ada Lovelace',
        team_id: team.id,
      });
      const bob = await workspace.addUser({
        name: 'Bob Builder',
        team_id: team.id,
      });
      const elsewhere = await t.createWorkspace();
      const stranger = await elsewhere.addUser();

      await t.slack
        .submitView(workspace, admin, await openTeamForm(team.id), {
          [TeamModalActionId.Members]: [ada.id, stranger.id],
        })
        .expect(200);

      expect(await teamOf(ada)).toBe(team.id);
      expect(await teamOf(bob)).toBeNull();
      expect((await elsewhere.row('users', stranger.id)).team_id).toBeNull();
    });
  });
});
