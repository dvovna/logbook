import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { PersonRateModalActionId } from '@modules/slack/tabs/projects/enums/person-rate-modal-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import {
  TeamModalActionId,
  TeamsTabViewActionId,
} from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { chooseTeamRules } from './support/team-form';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { seedReceipt, seedReimbursement } from './support/receipts';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { fillForm, findAction } from './support/block-kit';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { modalError, sectionTexts } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

const USERS_TAB = [NavigationActionId.People];
const TIME_OFF = [NavigationActionId.TimeOff];
const REQUESTS_TAB = [
  NavigationActionId.TimeOff,
  NavigationActionId.AllRequests,
];
const PROJECTS_TAB = [NavigationActionId.Projects];
const TEAMS_TAB = [NavigationActionId.Teams];

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

    it("shows only their teams' upcoming time off in Time off", async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const upcoming = '29 Jun – 3 Jul 2026';
      const whoIsOff = async (user: Tables<'users'>) =>
        sectionTexts(await openAppHomeTab(t, workspace, user, TIME_OFF)).find(
          (text) => text.startsWith("*🟢 Who's off next*"),
        );

      expect(await whoIsOff(manager)).toBe(
        `*🟢 Who's off next*\n• *Anna Ownteam* · ${upcoming}`,
      );
      // Admin and HR see everyone's, the soonest first, then the latest
      // request.
      expect(await whoIsOff(admin)).toBe(
        `*🟢 Who's off next*\n• *Boris Otherteam* · ${upcoming}\n• *Anna Ownteam* · ${upcoming}`,
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

    // The names the people select `actionId` in `view` offers `user`.
    const suggestedNames = async (
      user: Tables<'users'>,
      view: View,
      actionId: string,
    ) => {
      const response = await t.slack
        .suggest(workspace, user, view, actionId, '')
        .expect(acknowledged);

      return [
        actionId,
        response.body.options
          .map(({ text }: { text: { text: string } }) => text.text)
          .sort(),
      ];
    };

    // Only the external select `actionId`: the client sends the action ID of
    // a search, whatever view the app showed it.
    const viewWithSelect = (actionId: string) =>
      ({
        type: 'modal',
        title: { type: 'plain_text', text: 'Forged' },
        blocks: [
          {
            type: 'input',
            block_id: 'forged',
            label: { type: 'plain_text', text: 'Person' },
            element: { type: 'external_select', action_id: actionId },
          },
        ],
      }) as View;

    it("finds only their teams' people to filter People and All requests by", async () => {
      for (const [path, filter] of [
        [USERS_TAB, UsersTabViewActionId.FilterUsersByUser],
        [REQUESTS_TAB, VacationRequestsTabViewActionId.FilterRequestsByUser],
      ] as const) {
        const tab = await openAppHomeTab(t, workspace, manager, [...path]);

        // Not themselves: they are in none of their teams, so the list
        // doesn't show them.
        expect(await suggestedNames(manager, tab, filter)).toEqual([
          filter,
          ['Anna Ownteam'],
        ]);
      }
    });

    it("finds only their teams' people in the people selects of Admin's and HR's forms", async () => {
      const admin = await workspace.addUser({
        role: UserRole.Admin,
        name: 'Ada Admin',
      });

      for (const select of [
        TeamModalActionId.Members,
        PersonRateModalActionId.Person,
        TimeEntriesTabViewActionId.SelectUser,
        TimeEntriesTabViewActionId.FilterByUser,
        VacationRequestsTabViewActionId.UserField,
      ]) {
        const view = viewWithSelect(select);

        expect(await suggestedNames(admin, view, select)).toEqual([
          select,
          ['Ada Admin', 'Anna Ownteam', 'Boris Otherteam', 'Max Manager'],
        ]);
        // Person Rates is for those who set rates: a manager finds nobody.
        expect(await suggestedNames(manager, view, select)).toEqual([
          select,
          select === PersonRateModalActionId.Person ? [] : ['Anna Ownteam'],
        ]);
        expect(await suggestedNames(ownTeam, view, select)).toEqual([
          select,
          [],
        ]);
      }
    });

    it("finds everyone to assign to a project, as the form's teams are everyone's", async () => {
      const project = await workspace.addProject({ name: 'Website' });
      const select = ProjectAssignmentModalViewActionId.ProjectUsers;
      const modal = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, PROJECTS_TAB),
        ProjectsTabViewActionId.ManageProjectMenu,
        `${ProjectsTabViewActionId.ManageProjectAssignments}:${project.id}`,
      );

      expect(await suggestedNames(manager, modal, select)).toEqual([
        select,
        ['Anna Ownteam', 'Boris Otherteam', 'Max Manager'],
      ]);
      // A member opens no Projects.
      expect(await suggestedNames(ownTeam, modal, select)).toEqual([
        select,
        [],
      ]);
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

    it('are not decided on as receipts, nor is a form opened for them', async () => {
      const finance = await workspace.addUser({ role: UserRole.Finance });
      await seedReimbursement(t, workspace);
      const strangersGym = await seedReimbursement(t, other);
      const stranger = await other.addUser({ name: 'Stranger' });
      const strangers = await seedReceipt(t, other, stranger, {
        reimbursement: strangersGym,
        month: '2026-06-01',
        amountCents: 1000,
      });
      const screen = await openAppHomeTab(t, workspace, finance, [
        NavigationActionId.Receipts,
      ]);
      const since = t.slackApi.mark();

      await forge(finance, screen, {
        type: 'button',
        action_id: ReceiptsTabActionId.AcceptReceipt,
        value: strangers.id,
      });
      await forge(finance, screen, {
        type: 'button',
        action_id: ReceiptsTabActionId.RejectReceipt,
        value: strangers.id,
      });
      await forge(
        finance,
        screen,
        menu(
          ReceiptsTabActionId.ManageReceiptMenu,
          `${ReceiptsTabActionId.AcceptReceipt}:${strangers.id}`,
        ),
      );

      expect(openedModals(since)).toHaveLength(0);
      expect(await other.rows('receipts')).toEqual([
        expect.objectContaining({
          id: strangers.id,
          status: ReceiptStatus.Submitted,
          decided_by: null,
        }),
      ]);
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

    it('are not placed by the new person question, nor is it closed for them', async () => {
      const stranger = await other.addUser({ name: 'Stranger' });
      const strangersTeam = await other.addTeam();
      const strangersHr = await other.addUser({ role: UserRole.HR });
      // The question the other workspace's HR has open about the stranger.
      await t.db
        .insertInto('new_person_prompts')
        .values({
          slack_team_id: other.id,
          user_id: stranger.id,
          recipient_slack_id: strangersHr.slack_id,
          channel: `D${strangersHr.slack_id.slice(1)}`,
          ts: '1.0001',
        })
        .execute();
      await workspace.addTeam();
      const before = {
        users: await other.rows('users'),
        prompts: await other.rows('new_person_prompts'),
      };
      const forged = [
        {
          type: 'static_select',
          action_id: 'choose_team',
          selected_option: option(`${stranger.id}|${strangersTeam.id}`),
        },
        {
          type: 'button',
          action_id: 'not_yet',
          value: `not_yet:${stranger.id}`,
        },
      ];

      for (const action of forged) {
        await t.slack
          .interaction({
            type: 'block_actions',
            team: { id: workspace.slackId },
            user: { id: admin.slack_id, team_id: workspace.slackId },
            trigger_id: 'trigger-forged',
            container: { type: 'message', message_ts: '1.0001' },
            channel: { id: `D${admin.slack_id.slice(1)}` },
            message: { ts: '1.0001', text: 'Which team?', blocks: [] },
            actions: [
              {
                block_id: ViewCallbackId.NewPersonPrompt,
                action_ts: '1',
                ...action,
              },
            ],
          })
          .expect(200);
        await t.idle();
      }

      expect(
        t.slackApi
          .ephemeralMessages(workspace.token, admin.slack_id)
          .map(({ text }) => text),
      ).toEqual([
        'This question is no longer open. Nothing changed.',
        'This question is no longer open. Nothing changed.',
      ]);
      expect({
        users: await other.rows('users'),
        prompts: await other.rows('new_person_prompts'),
      }).toEqual(before);
      expect(t.slackApi.callsWith(other.token, 'chat.update')).toEqual([]);
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

      const newTeam = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, TEAMS_TAB),
        TeamsTabViewActionId.AddTeam,
      );
      const addTeam = await chooseTeamRules(
        t,
        workspace,
        admin,
        newTeam,
        TeamRulesChoice.Own,
      );
      const teamResponse = await submitForged(
        admin,
        addTeam,
        { name: 'Ops' },
        { policy: strangersPolicy.id },
      );
      expect(teamResponse.body).toMatchObject({
        response_action: 'errors',
        errors: {
          [findAction(addTeam.blocks, 'policy').blockId]:
            'This vacation policy is not in this workspace.',
        },
      });
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
