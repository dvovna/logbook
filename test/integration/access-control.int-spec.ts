import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { navigate, openAppHomeTab, openModalFrom } from './support/app-home';
import { fillForm, findAction, SlackJson } from './support/block-kit';
import { actionIdsOf, listItems, modalError } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

// The navigation actions that open a screen: all but the More menu itself
// and the Settings button of views published before it.
const SCREEN_ACTIONS = Object.values(NavigationActionId).filter(
  (actionId) =>
    actionId !== NavigationActionId.Menu &&
    actionId !== NavigationActionId.Settings,
);

// The screens the navigation's More menu offers.
const menuValuesOf = (view: View): string[] =>
  (view.blocks as SlackJson[])
    .flatMap((block) => block.elements ?? [])
    .filter(({ action_id }) => action_id === NavigationActionId.Menu)
    .flatMap((menu) => [
      ...(menu.options ?? []),
      ...(menu.option_groups ?? []).flatMap((group) => group.options),
    ])
    .map((option) => option.value);

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
  let finance: Tables<'users'>;

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
    finance = await workspace.addUser({
      role: UserRole.Finance,
      name: 'Fay Finance',
    });
  });

  describe('tabs', () => {
    // Sends a navigation action from the user's Home, whether or not their
    // Home shows that button, and returns the tabs the app published. With
    // `menuValue`, the action is choosing that value in the More menu.
    const navigateFromHome = async (
      user: Tables<'users'>,
      actionId: NavigationActionId,
      menuValue?: string,
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
            menuValue === undefined
              ? {
                  type: 'button',
                  action_id: actionId,
                  block_id: ViewCallbackId.HomeTabView,
                  value: actionId,
                  action_ts: '1',
                }
              : {
                  type: 'static_select',
                  action_id: actionId,
                  block_id: ViewCallbackId.HomeTabView,
                  selected_option: {
                    text: { type: 'plain_text', text: menuValue },
                    value: menuValue,
                  },
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
      NavigationActionId.People,
      NavigationActionId.Teams,
      NavigationActionId.AllRequests,
      NavigationActionId.Clients,
      NavigationActionId.Projects,
      NavigationActionId.Approvals,
      NavigationActionId.TimeLogs,
      NavigationActionId.Settings,
    ])('sends a member who asks for %s back to their Home', async (action) => {
      expect(await navigateFromHome(member, action)).toEqual([
        ViewCallbackId.HomeTabView,
      ]);
    });

    it.each([
      NavigationActionId.Teams,
      NavigationActionId.Clients,
      NavigationActionId.Menu,
      'not a screen',
    ])(
      'sends a member who chooses %s in the More menu back to their Home',
      async (value) => {
        expect(
          await navigateFromHome(member, NavigationActionId.Menu, value),
        ).toEqual([ViewCallbackId.HomeTabView]);
      },
    );

    it.each([
      NavigationActionId.People,
      NavigationActionId.Approvals,
      NavigationActionId.AllRequests,
      NavigationActionId.Teams,
      NavigationActionId.Policies,
      NavigationActionId.TimeLogs,
    ])('keeps Finance out of %s: no people or approvals', async (action) => {
      expect(await navigateFromHome(finance, action)).toEqual([
        ViewCallbackId.HomeTabView,
      ]);
    });

    it.each(['manager', 'hr'] as const)(
      'keeps a %s out of Billing snapshots, which are for Admin and Finance',
      async (role) => {
        expect(
          await navigateFromHome(
            { manager, hr }[role],
            NavigationActionId.BillingSnapshots,
          ),
        ).toEqual([ViewCallbackId.HomeTabView]);
      },
    );

    it.each([
      NavigationActionId.Teams,
      NavigationActionId.Policies,
      NavigationActionId.TimeLogs,
    ])(
      'keeps managers out of %s, which is for Admin and HR',
      async (action) => {
        expect(await navigateFromHome(manager, action)).toEqual([
          ViewCallbackId.HomeTabView,
        ]);
      },
    );

    // The other way round: from Home, follow every navigation button a role
    // sees, on every screen it reaches. None may lead back to Home (a screen
    // the role may not open), and each role reaches what it should.
    it.each([
      [
        'member',
        [
          NavigationActionId.Home,
          NavigationActionId.MyTime,
          NavigationActionId.TimeOff,
          NavigationActionId.Reports,
        ],
      ],
      [
        'manager',
        [
          NavigationActionId.Home,
          NavigationActionId.MyTime,
          NavigationActionId.TimeOff,
          NavigationActionId.Approvals,
          NavigationActionId.People,
          NavigationActionId.Reports,
          NavigationActionId.Projects,
          NavigationActionId.Clients,
          NavigationActionId.AllRequests,
        ],
      ],
      [
        'hr',
        SCREEN_ACTIONS.filter(
          (action) => action !== NavigationActionId.BillingSnapshots,
        ),
      ],
      [
        'finance',
        [
          NavigationActionId.Home,
          NavigationActionId.MyTime,
          NavigationActionId.TimeOff,
          NavigationActionId.Reports,
          NavigationActionId.Projects,
          NavigationActionId.Clients,
          NavigationActionId.BillingSnapshots,
        ],
      ],
      ['admin', SCREEN_ACTIONS],
    ] as const)(
      'leads a %s from every button and menu option only to screens it may open',
      async (role, reachable) => {
        const user = { member, manager, hr, finance, admin }[role];
        const navigation = new Set<string>(SCREEN_ACTIONS);
        const followed = new Set<string>();
        const bounced: string[] = [];
        const screens: View[] = [await openAppHomeTab(t, workspace, user)];

        for (let view = screens.shift(); view; view = screens.shift()) {
          for (const actionId of [
            ...actionIdsOf(view),
            ...menuValuesOf(view),
          ]) {
            if (!navigation.has(actionId) || followed.has(actionId)) {
              continue;
            }

            followed.add(actionId);
            const opened = await navigate(t, workspace, user, view, actionId);

            if (
              opened.callback_id === ViewCallbackId.HomeTabView &&
              actionId !== NavigationActionId.Home
            ) {
              bounced.push(actionId);
            } else {
              screens.push(opened);
            }
          }
        }

        expect(bounced).toEqual([]);
        expect([...followed].sort()).toEqual([...reachable].sort());
      },
    );

    it('still opens the tabs a role may see', async () => {
      expect(
        await navigateFromHome(manager, NavigationActionId.People),
      ).toEqual([ViewCallbackId.UsersTabView]);
      expect(await navigateFromHome(hr, NavigationActionId.Teams)).toEqual([
        ViewCallbackId.TeamsTabView,
      ]);
      expect(
        await navigateFromHome(
          hr,
          NavigationActionId.Menu,
          NavigationActionId.Policies,
        ),
      ).toEqual([ViewCallbackId.VacationPoliciesTabView]);
      // The Settings button of a view published before the More menu.
      expect(
        await navigateFromHome(admin, NavigationActionId.Settings),
      ).toEqual([ViewCallbackId.TeamsTabView]);
    });
  });

  // Chooses `value` in the menu `actionId` of `view`, whether or not the menu
  // offers it, and returns the modal the app opened.
  const forgeMenuChoice = async (
    actor: Tables<'users'>,
    view: View,
    actionId: string,
    value: string,
  ) => {
    const since = t.slackApi.mark();

    await t.slack
      .interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: actor.slack_id, team_id: workspace.slackId },
        trigger_id: 'trigger-forged',
        container: { type: 'view' },
        view: { team_id: workspace.slackId, ...view },
        actions: [
          {
            type: 'overflow',
            action_id: actionId,
            block_id: 'forged',
            selected_option: {
              text: { type: 'plain_text', text: value },
              value,
            },
            action_ts: '1',
          },
        ],
      })
      .expect(200);
    await t.idle();

    return t.slackApi.shownModal(workspace.token, { since });
  };

  // The forms a role only looks at are refused when they open, not only
  // when they are submitted.
  describe('forms of a screen the role only reads', () => {
    const openedSince = (since: number) =>
      t.slackApi.callsWith(workspace.token, 'views.open', { since });

    it("doesn't open a project's assignments for Finance", async () => {
      const project = await workspace.addProject();
      const choice = `${ProjectsTabViewActionId.ManageProjectAssignments}:${project.id}`;

      for (const [actor, opens] of [
        [finance, 0],
        [manager, 1],
      ] as const) {
        const projects = await openAppHomeTab(t, workspace, actor, [
          NavigationActionId.Projects,
        ]);
        const since = t.slackApi.mark();

        await forgeMenuChoice(
          actor,
          projects,
          ProjectsTabViewActionId.ManageProjectMenu,
          choice,
        ).catch(() => undefined);

        expect(openedSince(since)).toHaveLength(opens);
      }
    });

    it("doesn't open the client forms for a manager", async () => {
      const client = await workspace.addClient();

      for (const [actor, opens] of [
        [manager, 0],
        [hr, 2],
      ] as const) {
        const clients = await openAppHomeTab(t, workspace, actor, [
          NavigationActionId.Clients,
        ]);
        const since = t.slackApi.mark();

        for (const action of [
          ClientsTabViewActionId.EditClient,
          ClientsTabViewActionId.ArchiveClient,
        ]) {
          await forgeMenuChoice(
            actor,
            clients,
            ClientsTabViewActionId.ManageClientMenu,
            `${action}:${client.id}`,
          ).catch(() => undefined);
        }

        expect(openedSince(since)).toHaveLength(opens);
      }
    });
  });

  describe('the Admin role', () => {
    const USERS_TAB = [NavigationActionId.People];

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

    const rolesOffered = (form: View) =>
      findAction(form.blocks as SlackJson[], 'role').element.options.map(
        ({ value }: { value: string }) => value,
      );

    // Submits the edit form with a role it may not offer.
    const submitRole = (actor: Tables<'users'>, form: View, role: UserRole) => {
      const state = fillForm(form, {}) as Record<
        string,
        Record<string, unknown>
      >;

      state.role_block = {
        role: {
          type: 'static_select',
          selected_option: {
            text: { type: 'plain_text', text: role },
            value: role,
          },
        },
      };

      return t.slack
        .interaction({
          type: 'view_submission',
          team: { id: workspace.slackId },
          user: { id: actor.slack_id, team_id: workspace.slackId },
          trigger_id: 'trigger-forged',
          view: {
            team_id: workspace.slackId,
            ...form,
            state: { values: state },
          },
        })
        .expect(200);
    };

    it('cannot be granted by HR, not even to themselves', async () => {
      for (const target of [member, hr]) {
        const form = await fromUsersMenu(
          hr,
          UsersTabViewActionId.EditUser,
          target,
        );
        expect(rolesOffered(form)).toEqual([
          UserRole.HR,
          UserRole.Manager,
          UserRole.Member,
        ]);

        const response = await submitRole(hr, form, UserRole.Admin);

        expect(modalError(response.body.view)).toContain(
          'Only an admin can grant or remove the Admin or Finance role',
        );
        expect((await workspace.row('users', target.id)).role).toBe(
          target.role,
        );
      }
    });

    // Finance sees the rates and money that HR doesn't.
    it('nor Finance, which HR neither grants nor takes away', async () => {
      for (const [target, role, offered] of [
        [member, UserRole.Finance, 3],
        [hr, UserRole.Finance, 3],
        [finance, UserRole.Member, 1],
      ] as const) {
        const form = await fromUsersMenu(
          hr,
          UsersTabViewActionId.EditUser,
          target,
        );
        expect(rolesOffered(form)).toHaveLength(offered);
        expect(rolesOffered(form)).not.toContain(role);

        const response = await submitRole(hr, form, role);

        expect(modalError(response.body.view)).toContain(
          'Only an admin can grant or remove the Admin or Finance role',
        );
        expect((await workspace.row('users', target.id)).role).toBe(
          target.role,
        );
      }

      const form = await fromUsersMenu(
        admin,
        UsersTabViewActionId.EditUser,
        member,
      );
      expect(rolesOffered(form)).toEqual([
        UserRole.Admin,
        UserRole.HR,
        UserRole.Manager,
        UserRole.Finance,
        UserRole.Member,
      ]);
      await t.slack
        .submitView(workspace, admin, form, { role: UserRole.Finance })
        .expect(200);
      expect((await workspace.row('users', member.id)).role).toBe(
        UserRole.Finance,
      );
    });

    it('cannot be taken from an admin, or the admin deactivated, by HR', async () => {
      const form = await fromUsersMenu(
        hr,
        UsersTabViewActionId.EditUser,
        admin,
      );
      expect(rolesOffered(form)).toEqual([UserRole.Admin]);
      const edit = await submitRole(hr, form, UserRole.Member);
      expect(modalError(edit.body.view)).toContain('Only an admin');

      // HR's menu of an admin has no Deactivate; an admin's has.
      const menuOf = async (actor: Tables<'users'>) =>
        listItems(await openAppHomeTab(t, workspace, actor, USERS_TAB)).find(
          ({ title }) => title === admin.name,
        )?.menuLabels;
      expect(await menuOf(hr)).toEqual(['Edit User', 'View Vacation Usage']);
      expect(await menuOf(admin)).toContain('Deactivate User');

      const confirmation = await forgeMenuChoice(
        hr,
        await openAppHomeTab(t, workspace, hr, USERS_TAB),
        UsersTabViewActionId.ManageUserMenu,
        `${UsersTabViewActionId.ChangeStatus}:${admin.id}`,
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
        .updateTable('users')
        .set({ team_id: team.id })
        .where('id', '=', manager.id)
        .execute();
      manager = await workspace.row('users', manager.id);

      const request = await requestVacation(t, workspace, manager, workWeek(2));

      // The manager level is left out, so the request goes straight to HR.
      // The manager hears only where it went, with nothing to approve.
      await approvalMessageTo(t, workspace, hr);
      await t.idle();
      expect(
        t.slackApi.postedMessages(workspace.token, manager.slack_id),
      ).toEqual([
        expect.objectContaining({
          text: expect.stringContaining(
            `went to <@${hr.slack_id}> (HR approval).`,
          ) as string,
        }),
      ]);
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
      await t.db
        .updateTable('users')
        .set({ team_id: team.id })
        .where('id', '=', hr.id)
        .execute();
      hr = await workspace.row('users', hr.id);

      const request = await requestVacation(t, workspace, hr, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      // The menu of their own request doesn't offer it; a colleague's does.
      const requests = await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]);
      expect(listItems(requests).map(({ menuLabels }) => menuLabels)).toEqual([
        ['View Details', 'Edit Request'],
      ]);

      const confirmation = await forgeMenuChoice(
        hr,
        requests,
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
      'currency',
      'id',
      'members_imported_at',
      'name',
      'slack_id',
      'time_off_minutes_per_day',
      'uninstalled_at',
    ]);
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
  });

  it('encrypts a bot token stored in plain text once it is read', async () => {
    const stored = async () =>
      (
        await t.db
          .selectFrom('slack_teams')
          .select('slack_token')
          .where('id', '=', workspace.id)
          .executeTakeFirstOrThrow()
      ).slack_token;
    // TestWorkspace stores its token in plain text, as the app did before, but
    // a test app starting in another worker encrypts every plain-text token in
    // the database. So it is set back to plain text right before the read.
    await t.db
      .updateTable('slack_teams')
      .set({ slack_token: workspace.token })
      .where('id', '=', workspace.id)
      .execute();

    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
    expect(await stored()).toMatch(/^v1:/);
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(workspace.id),
    ).toBe(workspace.token);
  });
});
