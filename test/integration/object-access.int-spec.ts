import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { fillForm } from './support/block-kit';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { modalError, sectionTexts } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

const USERS_TAB = [
  AdminNavigationActionId.ManagePeople,
  AdminNavigationActionId.ManageUsers,
];
const VACATIONS_HUB = [AdminNavigationActionId.ManageVacations];
const REQUESTS_TAB = [
  AdminNavigationActionId.ManageVacations,
  AdminNavigationActionId.ManageVacationRequests,
];
const PROJECTS_TAB = [
  AdminNavigationActionId.ManageTimeAndBilling,
  AdminNavigationActionId.ManageProjects,
];
const TEAMS_TAB = [
  AdminNavigationActionId.ManagePeople,
  AdminNavigationActionId.ManageTeams,
];

const option = (value: string) => ({
  text: { type: 'plain_text', text: value },
  value,
});

// Slack takes menu choices, button values and the values of a submitted form
// from the client, so these tests send IDs the UI would not offer (another
// person's, another team's, another workspace's) and check the server refuses
// them.
describe('Access to objects by ID', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  // An action in `view` with `action` as the user's choice.
  const forge = async (
    user: Tables<'users'>,
    view: View,
    action: Record<string, unknown>,
  ) => {
    await t.slack.interaction({
      type: 'block_actions',
      team: { id: workspace.slackId },
      user: { id: user.slack_id, team_id: workspace.slackId },
      trigger_id: 'trigger-forged',
      container: { type: 'view' },
      view: { team_id: workspace.slackId, ...view },
      actions: [{ block_id: 'forged', action_ts: '1', ...action }],
    });
    await t.idle();
  };

  const menu = (actionId: string, value: string) => ({
    type: 'overflow',
    action_id: actionId,
    selected_option: option(value),
  });

  const select = (actionId: string, value: string) => ({
    type: 'static_select',
    action_id: actionId,
    selected_option: option(value),
  });

  // The modals the app opened since `since`.
  const openedModals = (since: number) =>
    t.slackApi.callsWith(workspace.token, 'views.open', { since });

  // Submits `view` filled with `values`, with `forged` put into its selects
  // as options they don't offer (a list for a multi select).
  const submitForged = (
    user: Tables<'users'>,
    view: View,
    values: Record<string, string | string[] | undefined>,
    forged: Record<string, string | string[]>,
  ) => {
    const state = fillForm(view, values) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;

    for (const [actionId, value] of Object.entries(forged)) {
      const block = Object.values(state).find((fields) => actionId in fields);

      if (!block) {
        throw new Error(`The form has no ${actionId}`);
      }

      block[actionId] = Array.isArray(value)
        ? { ...block[actionId], selected_options: value.map(option) }
        : { type: 'static_select', selected_option: option(value) };
    }

    return t.slack
      .interaction({
        type: 'view_submission',
        team: { id: workspace.slackId },
        user: { id: user.slack_id, team_id: workspace.slackId },
        trigger_id: 'trigger-forged',
        view: { team_id: workspace.slackId, ...view, state: { values: state } },
      })
      .expect(200);
  };

  describe("someone else's vacation request", () => {
    it('is not shown to a member', async () => {
      const member = await workspace.addUser({ name: 'Mo Member' });
      const other = await workspace.addUser({ name: 'Ola Other' });
      const { start, end } = workWeek(2);
      const theirs = await workspace.addVacationRequest(other, {
        start_date: start,
        end_date: end,
        status: VacationRequestStatus.Pending,
      });
      const own = await workspace.addVacationRequest(member, {
        start_date: start,
        end_date: end,
        status: VacationRequestStatus.Pending,
      });
      const home = await openAppHomeTab(t, workspace, member);

      for (const [request, opens] of [
        [theirs, 0],
        [own, 1],
      ] as const) {
        const since = t.slackApi.mark();

        await forge(
          member,
          home,
          menu(
            HomeTabActionId.ManagePendingRequestMenu,
            `${HomeTabActionId.ViewDetails}:${request.id}`,
          ),
        );

        expect(openedModals(since)).toHaveLength(opens);
      }
    });
  });

  describe("a manager and other teams' people", () => {
    let manager: Tables<'users'>;
    let ownTeam: Tables<'users'>;
    let otherTeam: Tables<'users'>;
    let ownRequest: Tables<'vacation_requests'>;
    let otherRequest: Tables<'vacation_requests'>;
    let teamB: Tables<'teams'>;

    beforeEach(async () => {
      manager = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Max Manager',
      });
      const teamA = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      teamB = await workspace.addTeam();
      ownTeam = await workspace.addUser({
        name: 'Anna Ownteam',
        team_id: teamA.id,
      });
      otherTeam = await workspace.addUser({
        name: 'Boris Otherteam',
        team_id: teamB.id,
      });
      const { start, end } = workWeek(2);
      ownRequest = await workspace.addVacationRequest(ownTeam, {
        start_date: start,
        end_date: end,
      });
      otherRequest = await workspace.addVacationRequest(otherTeam, {
        start_date: start,
        end_date: end,
      });
    });

    it('lists only their teams, whatever team the filter names', async () => {
      for (const [path, filter] of [
        [REQUESTS_TAB, VacationRequestsTabViewActionId.FilterRequestsByTeam],
        [USERS_TAB, UsersTabViewActionId.FilterUsersByTeam],
      ] as const) {
        const tab = await openAppHomeTab(t, workspace, manager, [...path]);
        expect(JSON.stringify(tab)).toContain('Anna Ownteam');
        expect(JSON.stringify(tab)).not.toContain('Boris Otherteam');

        const since = t.slackApi.mark();
        await forge(manager, tab, select(filter, teamB.id));
        const filtered = await publishedHome(t, workspace, manager, since);

        expect(JSON.stringify(filtered)).not.toContain('Boris Otherteam');
      }
    });

    it("shows only their teams' upcoming vacations in the Vacations hub", async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const upcoming = '29 Jun – 3 Jul 2026';

      expect(
        sectionTexts(
          await openAppHomeTab(t, workspace, manager, VACATIONS_HUB),
        ),
      ).toContain(`• *Anna Ownteam* — ${upcoming}`);
      // Admin and HR see everyone's, the soonest first, then the latest
      // request.
      expect(
        sectionTexts(await openAppHomeTab(t, workspace, admin, VACATIONS_HUB)),
      ).toContain(
        `• *Boris Otherteam* — ${upcoming}\n• *Anna Ownteam* — ${upcoming}`,
      );
    });

    it("opens only their teams' requests, and no admin forms", async () => {
      const tab = await openAppHomeTab(t, workspace, manager, REQUESTS_TAB);

      for (const [action, request, opens] of [
        [VacationRequestsTabViewActionId.ViewDetails, otherRequest, 0],
        [VacationRequestsTabViewActionId.ViewDetails, ownRequest, 1],
        [VacationRequestsTabViewActionId.EditRequest, ownRequest, 0],
        [VacationRequestsTabViewActionId.DeleteRequest, ownRequest, 0],
        [VacationRequestsTabViewActionId.ApproveOnBehalf, ownRequest, 0],
      ] as const) {
        const since = t.slackApi.mark();

        await forge(
          manager,
          tab,
          menu(
            VacationRequestsTabViewActionId.ManageRequestMenu,
            `${action}:${request.id}`,
          ),
        );

        expect([action, openedModals(since).length]).toEqual([action, opens]);
      }
    });

    it("opens only their teams' people, and no admin forms", async () => {
      const tab = await openAppHomeTab(t, workspace, manager, USERS_TAB);

      for (const [action, user, opens] of [
        [UsersTabViewActionId.ViewVacationUsage, otherTeam, 0],
        [UsersTabViewActionId.ViewVacationUsage, ownTeam, 1],
        [UsersTabViewActionId.EditUser, ownTeam, 0],
        [UsersTabViewActionId.ChangeStatus, ownTeam, 0],
      ] as const) {
        const since = t.slackApi.mark();

        await forge(
          manager,
          tab,
          menu(UsersTabViewActionId.ManageUserMenu, `${action}:${user.id}`),
        );

        expect([action, openedModals(since).length]).toEqual([action, opens]);
      }
    });
  });

  describe("another approver's step", () => {
    it('cannot be approved or commented on by a manager', async () => {
      const first = await workspace.addUser({
        role: UserRole.Manager,
        name: 'First Manager',
      });
      const second = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Second Manager',
      });
      const team = await workspace.addTeam({
        manager_approvers: [first.slack_id, second.slack_id],
        manager_approvers_rule: ApprovalRule.All,
      });
      const member = await workspace.addUser({ team_id: team.id });
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const message = await approvalMessageTo(t, workspace, first);
      const secondStep = (await workspace.rows('request_workflow_steps')).find(
        ({ slack_user_id }) => slack_user_id === second.slack_id,
      )!;

      for (const action of [
        ApproverMessageActionId.Approve,
        ApproverMessageActionId.AddComment,
      ]) {
        await t.slack.interaction({
          type: 'block_actions',
          team: { id: workspace.slackId },
          user: { id: first.slack_id, team_id: workspace.slackId },
          trigger_id: 'trigger-forged',
          container: { type: 'message', message_ts: message.ts },
          channel: { id: message.channel },
          message: {
            ts: message.ts,
            text: message.text,
            blocks: message.blocks,
          },
          actions: [
            {
              type: 'button',
              action_id: action,
              block_id: 'workflow_step_message',
              value: `${action}:${secondStep.id}`,
              action_ts: '1',
            },
          ],
        });
      }
      await t.idle();

      const comment = t.slackApi.openedModal(workspace.token);
      const response = await t.slack
        .submitView(workspace, first, comment, { comment: 'Looks fine' })
        .expect(200);

      expect(modalError(response.body.view)).toContain(
        'assigned to someone else',
      );
      expect(await workspace.rows('request_workflow_step_comments')).toEqual(
        [],
      );
      expect(
        (await workspace.row('request_workflow_steps', secondStep.id))
          .completed_at,
      ).toBeNull();
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Pending);
    });
  });

  describe("someone else's time entry", () => {
    it('is not opened for editing by a member', async () => {
      const member = await workspace.addUser({ name: 'Mo Member' });
      const other = await workspace.addUser({ name: 'Ola Other' });
      const project = await workspace.addProject();
      const theirs = await workspace.addTimeEntry(other, project, {
        description: 'Secret work',
      });
      const own = await workspace.addTimeEntry(member, project);
      const entries = await openAppHomeTab(t, workspace, member, [
        HomeTabActionId.EditTimeEntries,
      ]);

      for (const [entry, opens] of [
        [theirs, 0],
        [own, 1],
      ] as const) {
        const since = t.slackApi.mark();

        await forge(
          member,
          entries,
          menu(
            TimeEntriesTabViewActionId.ManageTimeEntryMenu,
            `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
          ),
        );

        expect(openedModals(since)).toHaveLength(opens);
      }
    });
  });

  describe('IDs from outside the workspace', () => {
    let admin: Tables<'users'>;
    let other: TestWorkspace;

    beforeEach(async () => {
      admin = await workspace.addUser({ role: UserRole.Admin });
      other = await t.createWorkspace();
    });

    it('are not assigned to a project', async () => {
      const project = await workspace.addProject({ name: 'Website' });
      // Without a team of its own the form has no teams field.
      await workspace.addTeam();
      const stranger = await other.addUser({ name: 'Stranger' });
      const strangersTeam = await other.addTeam();
      const modal = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, PROJECTS_TAB),
        ProjectsTabViewActionId.ManageProjectMenu,
        `${ProjectsTabViewActionId.ManageProjectAssignments}:${project.id}`,
      );

      const forgedChoices: Record<string, string[]>[] = [
        { [ProjectAssignmentModalViewActionId.ProjectUsers]: [stranger.id] },
        {
          [ProjectAssignmentModalViewActionId.ProjectTeams]: [strangersTeam.id],
        },
      ];

      for (const forged of forgedChoices) {
        const response = await submitForged(admin, modal, {}, forged);

        expect(modalError(response.body.view)).toContain(
          'not in this workspace',
        );
      }

      expect(await workspace.rows('project_users')).toEqual([]);
      expect(await workspace.rows('project_teams')).toEqual([]);
    });

    it("are not a user's team, a project's client or a team's policy", async () => {
      const member = await workspace.addUser({ name: 'Mo Member' });
      const strangersTeam = await other.addTeam();
      const strangersClient = await other.addClient();
      const strangersPolicy = await other.addVacationPolicy();

      const editUser = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, USERS_TAB),
        UsersTabViewActionId.ManageUserMenu,
        `${UsersTabViewActionId.EditUser}:${member.id}`,
      );
      const userResponse = await submitForged(
        admin,
        editUser,
        {},
        { team_id: strangersTeam.id },
      );
      expect(modalError(userResponse.body.view)).toContain(
        'not in this workspace',
      );
      expect((await workspace.row('users', member.id)).team_id).toBeNull();

      const addProject = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, PROJECTS_TAB),
        ProjectsTabViewActionId.AddProject,
      );
      const projectResponse = await submitForged(
        admin,
        addProject,
        { name: 'Website' },
        { clientId: strangersClient.id },
      );
      expect(modalError(projectResponse.body.view)).toContain(
        'not in this workspace',
      );
      expect(await workspace.rows('projects')).toEqual([]);

      const addTeam = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, TEAMS_TAB),
        TeamsTabViewActionId.AddTeam,
      );
      const teamResponse = await submitForged(
        admin,
        addTeam,
        { name: 'Ops' },
        { policy: strangersPolicy.id },
      );
      expect(modalError(teamResponse.body.view)).toContain(
        'not in this workspace',
      );
      expect(await workspace.rows('teams')).toEqual([]);
    });
  });

  it('lets a member log time only on their projects', async () => {
    const member = await workspace.addUser({ name: 'Mo Member' });
    const theirs = await workspace.addProject({ name: 'Theirs' });
    const notTheirs = await workspace.addProject({ name: 'Not theirs' });
    await workspace.assignToProject(theirs, { users: [member] });

    const modal = await openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member),
      HomeTabActionId.LogTime,
    );
    const response = await submitForged(
      member,
      modal,
      { workDate: '2026-06-17', hours: '1' },
      { projectId: notTheirs.id },
    );

    expect(response.body).toEqual({
      response_action: 'errors',
      errors: { project_block: 'This project is not available.' },
    });
    expect(await workspace.rows('time_entries')).toEqual([]);
  });
});
