import * as background from '@common/utils/run-in-background';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { UsersService } from '@modules/users/services/users.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { textOf } from './support/block-kit';
import { addDays, workWeek } from './support/dates';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import {
  approvalMessageTo,
  requestVacation,
  VACATIONS_COMMAND,
} from './support/vacation-flows';

// A process that dies right after a change commits leaves only what the
// change's transaction saved: what it would start after the commit or its
// answer (first runs of jobs, event listeners, tab updates) never runs. The
// jobs that follow a change are saved with it, so the next process still
// does them (retryJobs); a job saved after the commit would be lost.
describe('Jobs after a crash', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Mary Manager',
    });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      manager_approvers_rule: ApprovalRule.Any,
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  // Runs `action` as the last thing a process does: the work it starts in
  // the background never runs.
  const crashingAfter = async <T>(action: () => Promise<T>): Promise<T> => {
    await t.idle();
    const spies = [
      jest
        .spyOn(background, 'runInBackground')
        .mockImplementation(() => undefined),
      jest
        .spyOn(background, 'startInBackground')
        .mockImplementation(() => Promise.resolve(undefined as never)),
    ];

    try {
      return await action();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  };

  const messagesTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);

  it('asks the approver of a request made just before', async () => {
    const since = t.slackApi.mark();
    await t.slack
      .command(VACATIONS_COMMAND, workspace, member, 'request')
      .expect(acknowledged);
    await t.idle();
    const form = t.slackApi.openedModal(workspace.token, { since });
    const { start, end } = workWeek(2);

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, member, form, {
          start_date: start,
          end_date: end,
          type_option: VacationType.AnnualLeave,
        })
        .expect(200),
    );

    expect(await workspace.rows('vacation_requests')).toHaveLength(1);
    expect(messagesTo(manager)).toEqual([]);

    await t.retryJobs();

    expect(messagesTo(manager)).toHaveLength(1);
  });

  it('tells the requester of a decision that finished the request just before', async () => {
    const request = await requestVacation(t, workspace, member, workWeek(2));
    await approvalMessageTo(t, workspace, manager);
    const [step] = await workspace.rows('request_workflow_steps');
    const approver = await t.app
      .get(UsersService)
      .findOneWithValidation({ id: manager.id, slackTeamId: workspace.id });
    const decisions = () =>
      messagesTo(member).filter((message) =>
        textOf(message).includes('Your time off request was approved'),
      );

    // The approval commits with the job that finishes the request; the next
    // process runs that job, and dies once the request is approved.
    await crashingAfter(() =>
      t.app.get(RequestWorkflowService).approveStep(step.id, approver),
    );
    await crashingAfter(() => t.retryJobs());

    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );

    await t.retryJobs();

    expect(decisions()).toHaveLength(1);
  });

  it('asks again for a request HR changed just before, its old approval closed with the change', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR });
    const { start, end } = workWeek(2);
    const request = await requestVacation(t, workspace, member, {
      start,
      end,
    });
    const toManager = await approvalMessageTo(t, workspace, manager);
    const form = await openModalFrom(
      t,
      workspace,
      hr,
      await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]),
      VacationRequestsTabViewActionId.ManageRequestMenu,
      `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
    );

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, hr, form, { end_date: addDays(end, -1) })
        .expect(200),
    );

    expect(
      (await workspace.rows('request_workflow_steps')).map(
        ({ completed_at }) => completed_at,
      ),
    ).toEqual([expect.any(String)]);

    await t.retryJobs();

    expect(t.slackApi.messageUpdates(workspace.token, toManager)).toHaveLength(
      1,
    );
    expect(messagesTo(manager)).toHaveLength(2);
    await t.slack
      .actOnMessage(
        workspace,
        manager,
        messagesTo(manager)[1],
        ApproverMessageActionId.Approve,
      )
      .expect(200);
    await t.idle();
    expect(await workspace.row('vacation_requests', request.id)).toMatchObject({
      status: VacationRequestStatus.Approved,
      end_date: addDays(end, -1),
    });
  });

  it('tells the approver of time submitted just before', async () => {
    const website = await workspace.addProject({ name: 'Website' });
    const entry = await workspace.addTimeEntry(member, website, {
      minutes: 120,
    });
    const home = await openAppHomeTab(t, workspace, member);
    const since = t.slackApi.mark();
    const toManager = () =>
      t.slackApi
        .postedMessages(workspace.token, manager.slack_id, { since })
        .map(({ text }) => text);

    await crashingAfter(() =>
      t.slack
        .actOnView(workspace, member, home, HomeTabActionId.SubmitTimeEntries)
        .expect(200),
    );

    expect((await workspace.row('time_entries', entry.id)).status).toBe(
      TimeEntryStatus.Submitted,
    );
    expect(toManager()).toEqual([]);

    await t.retryJobs();

    expect(toManager()).toEqual([
      expect.stringContaining('submitted *1 time entry* (2h)'),
    ]);
  });

  it('tells the owner of an entry rejected just before', async () => {
    const website = await workspace.addProject({ name: 'Website' });
    const entry = await workspace.addTimeEntry(member, website, {
      status: TimeEntryStatus.Submitted,
    });
    const form = await openModalFrom(
      t,
      workspace,
      manager,
      await openAppHomeTab(t, workspace, manager, [
        NavigationActionId.Approvals,
      ]),
      ApprovalsTabActionId.RejectEntry,
      entry.id,
    );

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, manager, form, { reason: 'Wrong project' })
        .expect(200),
    );

    expect((await workspace.row('time_entries', entry.id)).status).toBe(
      TimeEntryStatus.Rejected,
    );
    expect(messagesTo(member)).toEqual([]);

    await t.retryJobs();

    expect(messagesTo(member).map(({ text }) => text)).toEqual([
      expect.stringContaining('rejected your time entry'),
    ]);
  });

  it('adds a member whose join Slack sent just before', async () => {
    const id = slackId('U');
    const joined = async () =>
      (await workspace.rows('users')).find(({ slack_id }) => slack_id === id);

    await crashingAfter(() =>
      t.slack
        .event(workspace, {
          type: 'team_join',
          user: {
            id,
            team_id: workspace.slackId,
            name: 'ada',
            real_name: 'Ada Lovelace',
            profile: { email: 'ada@example.test' },
            is_admin: false,
            is_owner: false,
            is_bot: false,
            deleted: false,
          },
        })
        .expect(acknowledged),
    );

    expect(await joined()).toBeUndefined();

    await t.retryJobs();

    expect(await joined()).toMatchObject({ name: 'Ada Lovelace' });
  });
});
