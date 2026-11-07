import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { ADMIN_TABS } from '@modules/slack/common/views/data/admin-tabs';
import { actionIdsOf, modalError } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

// Slack takes action ids, button values and menu choices from the client, so
// hiding a button is not access control: these tests send what the UI would
// never offer and check the server refuses it.
describe('Access control', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let hr: Tables<'users'>;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Max Manager',
    });
    member = await workspace.addUser({ name: 'Mo Member' });
  });

  describe('tabs', () => {
    // Sends a navigation action from the user's Home, whether or not their
    // Home shows that button, and returns the tabs the app published.
    const navigateFromHome = async (
      user: Tables<'users'>,
      actionId: AdminNavigationActionId,
    ) => {
      const home: View = await openAppHomeTab(t, workspace, user);
      const since = t.slackApi.mark();

      await t.slack
        .interaction({
          type: 'block_actions',
          team: { id: workspace.slackId },
          user: { id: user.slack_id, team_id: workspace.slackId },
          trigger_id: 'trigger-forged',
          container: { type: 'view' },
          view: { team_id: workspace.slackId, ...home },
          actions: [
            {
              type: 'button',
              action_id: actionId,
              block_id: ViewCallbackId.HomeTabView,
              value: actionId,
              action_ts: '1',
            },
          ],
        })
        .expect(200);
      await t.idle();

      return t.slackApi
        .callsWith(workspace.token, 'views.publish', { since })
        .map(({ params }) => params.view.callback_id);
    };

    it.each([
      AdminNavigationActionId.ManageUsers,
      AdminNavigationActionId.ManageTeams,
      AdminNavigationActionId.ManageVacationRequests,
      AdminNavigationActionId.ManageClients,
      AdminNavigationActionId.ManageProjects,
    ])('sends a member who asks for %s back to their Home', async (action) => {
      expect(await navigateFromHome(member, action)).toEqual([
        ViewCallbackId.HomeTabView,
      ]);
    });

    it('keeps managers out of Teams, which is for Admin and HR', async () => {
      expect(
        await navigateFromHome(manager, AdminNavigationActionId.ManageTeams),
      ).toEqual([ViewCallbackId.HomeTabView]);
    });

    // The other way round: a button the role sees must not lead back to Home.
    it.each(['manager', 'hr', 'admin'] as const)(
      'offers a %s only the sections it can open',
      async (role) => {
        const user = { manager, hr, admin }[role];
        const topNavigation = new Set<string>(
          ADMIN_TABS.map(({ actionId }) => actionId),
        );
        const sections = new Set<string>(
          Object.values(AdminNavigationActionId),
        );
        const bounced: string[] = [];

        for (const hub of [
          AdminNavigationActionId.ManagePeople,
          AdminNavigationActionId.ManageTimeAndBilling,
          AdminNavigationActionId.ManageVacations,
        ]) {
          const hubTab = await openAppHomeTab(t, workspace, user, [hub]);
          const offered = actionIdsOf(hubTab).filter(
            (id) => sections.has(id) && !topNavigation.has(id),
          );

          for (const actionId of offered) {
            const since = t.slackApi.mark();
            await t.slack
              .actOnView(workspace, user, hubTab, actionId)
              .expect(200);
            await t.idle();

            const published = t.slackApi
              .callsWith(workspace.token, 'views.publish', { since })
              .map(({ params }) => params.view.callback_id);

            if (published.includes(ViewCallbackId.HomeTabView)) {
              bounced.push(actionId);
            }
          }
        }

        expect(bounced).toEqual([]);
      },
    );

    it('still opens the tabs a role may see', async () => {
      expect(
        await navigateFromHome(manager, AdminNavigationActionId.ManageUsers),
      ).toEqual([ViewCallbackId.UsersTabView]);
      expect(
        await navigateFromHome(hr, AdminNavigationActionId.ManageTeams),
      ).toEqual([ViewCallbackId.TeamsTabView]);
    });
  });

  describe('the Admin role', () => {
    const USERS_TAB = [
      AdminNavigationActionId.ManagePeople,
      AdminNavigationActionId.ManageUsers,
    ];

    const fromUsersMenu = async (
      actor: Tables<'users'>,
      action: UsersTabViewActionId,
      target: Tables<'users'>,
    ) =>
      openModalFrom(
        t,
        workspace,
        actor,
        await openAppHomeTab(t, workspace, actor, USERS_TAB),
        UsersTabViewActionId.ManageUserMenu,
        `${action}:${target.id}`,
      );

    it('cannot be granted by HR, not even to themselves', async () => {
      for (const target of [member, hr]) {
        const form = await fromUsersMenu(
          hr,
          UsersTabViewActionId.EditUser,
          target,
        );
        const response = await t.slack
          .submitView(workspace, hr, form, { role: UserRole.Admin })
          .expect(200);

        expect(modalError(response.body.view)).toContain(
          'Only an admin can grant or remove the Admin role',
        );
        expect((await workspace.row('users', target.id)).role).toBe(
          target.role,
        );
      }
    });

    it('cannot be taken from an admin, or the admin deactivated, by HR', async () => {
      const form = await fromUsersMenu(
        hr,
        UsersTabViewActionId.EditUser,
        admin,
      );
      const edit = await t.slack
        .submitView(workspace, hr, form, { role: UserRole.Member })
        .expect(200);
      expect(modalError(edit.body.view)).toContain('Only an admin');

      const confirmation = await fromUsersMenu(
        hr,
        UsersTabViewActionId.ChangeStatus,
        admin,
      );
      const deactivate = await t.slack
        .submitView(workspace, hr, confirmation)
        .expect(200);
      expect(modalError(deactivate.body.view)).toContain('Only an admin');

      expect(await workspace.row('users', admin.id)).toMatchObject({
        role: UserRole.Admin,
        is_active: true,
      });
    });

    it('is granted by an admin', async () => {
      const form = await fromUsersMenu(
        admin,
        UsersTabViewActionId.EditUser,
        member,
      );
      await t.slack
        .submitView(workspace, admin, form, { role: UserRole.Admin })
        .expect(200);

      expect((await workspace.row('users', member.id)).role).toBe(
        UserRole.Admin,
      );
    });
  });

  describe('own vacation requests', () => {
    it("leaves an approver out of their own request's approval", async () => {
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
        hr_approvers: [hr.slack_id],
      });
      await t.db
        .from('users')
        .update({ team_id: team.id })
        .eq('id', manager.id);
      manager = await workspace.row('users', manager.id);

      const request = await requestVacation(t, workspace, manager, workWeek(2));

      // The manager level is left out, so the request goes straight to HR.
      await approvalMessageTo(t, workspace, hr);
      expect(
        t.slackApi.postedMessages(workspace.token, manager.slack_id),
      ).toEqual([]);
      const steps = await workspace.rows('request_workflow_steps');
      expect(steps.map(({ slack_user_id }) => slack_user_id)).toEqual([
        hr.slack_id,
      ]);
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Pending);
    });

    it('cannot be approved by HR for the approvers when it is their own', async () => {
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      await t.db.from('users').update({ team_id: team.id }).eq('id', hr.id);
      hr = await workspace.row('users', hr.id);

      const request = await requestVacation(t, workspace, hr, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      const confirmation = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, [
          AdminNavigationActionId.ManageVacations,
          AdminNavigationActionId.ManageVacationRequests,
        ]),
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${VacationRequestsTabViewActionId.ApproveOnBehalf}:${request.id}`,
      );
      const response = await t.slack
        .submitView(workspace, hr, confirmation)
        .expect(200);

      expect(modalError(response.body.view)).toContain(
        "You can't approve your own vacation request.",
      );
      await t.idle();
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Pending);
    });
  });

  it('keeps bot tokens out of the workspace objects the app passes around', async () => {
    const team = await t.app
      .get(SlackTeamsService)
      .findOne({ id: workspace.id });

    expect(Object.keys(team!).sort()).toEqual([
      'created_at',
      'id',
      'name',
      'slack_id',
    ]);
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
  });

  it('encrypts a bot token stored in plain text once it is read', async () => {
    const stored = async () =>
      (
        await t.db
          .from('slack_teams')
          .select('slack_token')
          .eq('id', workspace.id)
          .single()
      ).data!.slack_token;
    // TestWorkspace stores its token in plain text, as the app did before, but
    // a test app starting in another worker encrypts every plain-text token in
    // the database. So it is set back to plain text right before the read.
    await t.db
      .from('slack_teams')
      .update({ slack_token: workspace.token })
      .eq('id', workspace.id);

    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
    expect(await stored()).toMatch(/^v1:/);
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
  });
});
