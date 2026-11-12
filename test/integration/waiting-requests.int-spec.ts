import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { formatDateRange } from '@common/utils/date.utils';
import { JobsService } from '@common/jobs/jobs.service';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { UsersService } from '@modules/users/services/users.service';
import { START_WAITING_JOB } from '@modules/vacation-requests/constants/jobs';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import { textOf } from './support/block-kit';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

// A request that nobody could approve when it was made (its requester is the
// only admin, and nobody has HR) waits. Once someone can approve it, it goes
// to them as a new request would, and its requester hears where it went.
describe('Requests waiting for anyone who can approve them', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let ada: Tables<'users'>;
  let bo: Tables<'users'>;
  const week = workWeek(2);
  const dates = formatDateRange(week.start, week.end);

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    // The only admin, in no team.
    ada = await workspace.addUser({ role: UserRole.Admin, name: 'Ada Admin' });
    bo = await workspace.addUser({ name: 'Bo Member' });
  });

  const messagesTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);

  const textsTo = (user: Tables<'users'>) =>
    messagesTo(user).map(({ text }) => text);

  const stepsOf = async (request: Tables<'vacation_requests'>) =>
    (await workspace.rows('request_workflow_steps')).filter(
      ({ request_id }) => request_id === request.id,
    );

  const requestAsAda = async () => {
    const request = await requestVacation(t, workspace, ada, week);
    await t.idle();

    return request;
  };

  // As People → Edit User does it, by Ada.
  const change = async (
    user: Tables<'users'>,
    changes: { role?: UserRole; isActive?: boolean },
  ) => {
    const users = t.app.get(UsersService);
    const actor = await users.findBySlackId(ada.slack_id, workspace.id);
    await users.update(
      { id: user.id, slackTeamId: workspace.id },
      changes,
      actor!,
    );
    await t.idle();
  };

  const NOBODY_YET = `⚠️ Nobody can approve your vacation request (${dates}) yet: you are not in a team and the company rules name no other approvers, and nobody else has the HR or Admin role. It goes for approval once an admin names approvers in the company rules or gives someone the HR or Admin role.`;

  it("keeps a lone admin's request pending with no workflow, and says so", async () => {
    const request = await requestAsAda();

    expect(textsTo(ada)).toEqual([NOBODY_YET]);
    expect(await stepsOf(request)).toEqual([]);
    expect(await workspace.row('vacation_requests', request.id)).toMatchObject({
      status: VacationRequestStatus.Pending,
      awaits_approvers: true,
    });
  });

  it('sends it to someone given the HR role, who can approve it', async () => {
    const request = await requestAsAda();

    await change(bo, { role: UserRole.HR });

    const approval = await approvalMessageTo(t, workspace, bo);
    expect(textOf(approval)).toContain('Ada Admin');
    expect(textsTo(ada)).toEqual([
      NOBODY_YET,
      `📨 Your vacation request (${dates}) went to HR for approval: you are not in a team and the company rules name no other approvers.`,
    ]);
    expect(
      (await workspace.row('vacation_requests', request.id)).awaits_approvers,
    ).toBe(false);

    await t.slack
      .actOnMessage(workspace, bo, approval, ApproverMessageActionId.Approve)
      .expect(200);
    await t.idle();
    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );
  });

  it('sends it to someone given the Admin role on People', async () => {
    const request = await requestAsAda();
    const form = await openModalFrom(
      t,
      workspace,
      ada,
      await openAppHomeTab(t, workspace, ada, [NavigationActionId.People]),
      UsersTabViewActionId.ManageUserMenu,
      `${UsersTabViewActionId.EditUser}:${bo.id}`,
    );

    await t.slack
      .submitView(workspace, ada, form, { role: UserRole.Admin })
      .expect(200);
    await t.idle();

    expect(textOf(await approvalMessageTo(t, workspace, bo))).toContain(
      'Ada Admin',
    );
    const [step] = await stepsOf(request);
    expect(step.step_data).toMatchObject({ level_name: 'Admin approval' });
    expect(textsTo(ada)).toEqual([
      NOBODY_YET,
      `📨 Your vacation request (${dates}) went to the workspace admins for approval: you are not in a team and the company rules name no other approvers.`,
    ]);
  });

  it("sends it to a manager put on the team's approvers", async () => {
    const team = await workspace.addTeam({ name: 'Design' });
    await t.db
      .updateTable('users')
      .set({ team_id: team.id })
      .where('id', '=', ada.id)
      .execute();
    const mia = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Mia Manager',
    });
    await requestVacation(t, workspace, { ...ada, team_id: team.id }, week);
    await t.idle();
    expect(messagesTo(mia)).toEqual([]);

    const form = await openModalFrom(
      t,
      workspace,
      ada,
      await openAppHomeTab(t, workspace, ada, [NavigationActionId.Teams]),
      TeamsTabViewActionId.ManageTeamMenu,
      `${TeamsTabViewActionId.EditTeam}:${team.id}`,
    );
    await t.slack
      .submitView(workspace, ada, form, { manager_approvers: [mia.slack_id] })
      .expect(200);
    await t.idle();

    expect(textOf(await approvalMessageTo(t, workspace, mia))).toContain(
      'Ada Admin',
    );
    expect(textsTo(ada).slice(-1)).toEqual([
      `📨 Your vacation request (${dates}) went to <@${mia.slack_id}> (Manager approval).`,
    ]);
  });

  // The rules of a request asked already are those of when it was made.
  it('leaves a request that has a workflow alone', async () => {
    const mia = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({ manager_approvers: [mia.slack_id] });
    const max = await workspace.addUser({ team_id: team.id, name: 'Max' });
    const asked = await requestVacation(t, workspace, max, week);
    await approvalMessageTo(t, workspace, mia);
    const stepsBefore = await stepsOf(asked);
    const waiting = await requestAsAda();

    await change(bo, { role: UserRole.HR });

    expect(await stepsOf(asked)).toEqual(stepsBefore);
    expect(await stepsOf(waiting)).toEqual([
      expect.objectContaining({ slack_user_id: bo.slack_id }),
    ]);
    expect(messagesTo(bo)).toHaveLength(1);
  });

  it('starts one workflow however many times it is looked at', async () => {
    const request = await requestAsAda();
    // HR given without the app hearing of it: only the job starts it.
    await t.db
      .updateTable('users')
      .set({ role: UserRole.HR })
      .where('id', '=', bo.id)
      .execute();
    const jobs = t.app.get(JobsService);

    await Promise.all([
      jobs.run(START_WAITING_JOB, { slackTeamId: workspace.id }),
      jobs.run(START_WAITING_JOB, { slackTeamId: workspace.id }),
    ]);
    await t.idle();
    await t.retryJobs();

    expect(await stepsOf(request)).toHaveLength(1);
    expect(messagesTo(bo)).toHaveLength(1);
    expect(textsTo(ada)).toHaveLength(2);
  });

  it('leaves it waiting, and tells nobody, while nobody can approve it', async () => {
    const request = await requestAsAda();

    await change(bo, { role: UserRole.Finance });
    await t.app
      .get(JobsService)
      .run(START_WAITING_JOB, { slackTeamId: workspace.id });
    await t.idle();

    expect(textsTo(ada)).toEqual([NOBODY_YET]);
    expect(await stepsOf(request)).toEqual([]);
    expect(
      (await workspace.row('vacation_requests', request.id)).awaits_approvers,
    ).toBe(true);
  });

  // An import is history: its pending requests go to nobody.
  it('sends an imported pending request to nobody', async () => {
    const imported = await workspace.addVacationRequest(bo, {
      start_date: week.start,
      end_date: week.end,
      status: VacationRequestStatus.Pending,
    });
    const cy = await workspace.addUser({ name: 'Cy' });

    await change(cy, { role: UserRole.HR });

    expect(await stepsOf(imported)).toEqual([]);
    expect(messagesTo(cy)).toEqual([]);
    expect(messagesTo(bo)).toEqual([]);
  });
});
