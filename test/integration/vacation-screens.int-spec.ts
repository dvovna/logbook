import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { CommonViewActionId } from '@modules/slack/enums/common-view-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { IPostedMessage } from './support/fake-slack-api.client';
import { workWeek } from './support/dates';
import { actOnTab, openAppHomeTab, openModalFrom } from './support/app-home';
import { listItems } from './support/tab-readers';
import { requestVacation } from './support/vacation-flows';

// The screens that only show a request, and two approvers deciding at once.
describe('Vacation screens', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let anna: Tables<'users'>;
  let boris: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    anna = await workspace.addUser({ role: UserRole.Manager, name: 'Anna' });
    boris = await workspace.addUser({ role: UserRole.Manager, name: 'Boris' });
    const team = await workspace.addTeam({
      manager_approvers: [anna.slack_id, boris.slack_id],
      manager_approvers_rule: ApprovalRule.Any,
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  it('shows the details of a pending request from Home', async () => {
    const week = workWeek(2);
    const request = await requestVacation(t, workspace, member, {
      ...week,
      comment: 'Family trip',
    });

    const details = textOf(
      await openModalFrom(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member),
        HomeTabActionId.ManagePendingRequestMenu,
        `${HomeTabActionId.ViewDetails}:${request.id}`,
      ),
    );

    expect(details).toContain(`${week.start} → ${week.end}`);
    expect(details).toContain('Annual Leave');
    expect(details).toContain('5 (5 working)');
    expect(details).toContain('Pending');
    expect(details).toContain('Family trip');
    expect(details).toContain(`⏳ *Pending* by <@${anna.slack_id}>`);
    expect(details).toContain(`⏳ *Pending* by <@${boris.slack_id}>`);
  });

  it('lists the pending and approved requests in the history', async () => {
    const approved = await workspace.addVacationRequest(member, {
      start_date: '2026-03-02',
      end_date: '2026-03-06',
      days: 5,
      working_days: 5,
    });
    await workspace.addVacationRequest(member, {
      start_date: '2026-04-06',
      end_date: '2026-04-06',
      status: VacationRequestStatus.Rejected,
    });

    const history = await openAppHomeTab(t, workspace, member, [
      HomeTabActionId.ViewHistory,
    ]);

    expect(listItems(history)).toEqual([
      expect.objectContaining({
        id: approved.id,
        menu: [VacationHistoryTabViewActionId.ViewDetails],
      }),
    ]);

    const details = await openModalFrom(
      t,
      workspace,
      member,
      history,
      VacationHistoryTabViewActionId.ManageRequestMenu,
      `${VacationHistoryTabViewActionId.ViewDetails}:${approved.id}`,
    );
    expect(textOf(details)).toContain('2026-03-02 → 2026-03-06');

    const home = await actOnTab(
      t,
      workspace,
      member,
      history,
      CommonViewActionId.BackToHomeTab,
    );
    expect(home.callback_id).toBe(ViewCallbackId.HomeTabView);
  });

  it('approves once when two approvers click at the same time', async () => {
    // Five requests, all ten clicks at once: one pair alone does not always
    // land in between.
    const pairs: {
      request: Tables<'vacation_requests'>;
      toAnna: IPostedMessage;
      toBoris: IPostedMessage;
    }[] = [];
    for (let week = 2; week <= 6; week += 1) {
      const request = await requestVacation(
        t,
        workspace,
        member,
        workWeek(week),
      );
      await t.idle();
      const [toAnna] = t.slackApi
        .postedMessages(workspace.token, anna.slack_id)
        .slice(-1);
      const [toBoris] = t.slackApi
        .postedMessages(workspace.token, boris.slack_id)
        .slice(-1);
      pairs.push({ request, toAnna, toBoris });
    }

    await Promise.all(
      pairs.flatMap(({ toAnna, toBoris }) => [
        t.slack
          .actOnMessage(
            workspace,
            anna,
            toAnna,
            ApproverMessageActionId.Approve,
          )
          .expect(200),
        t.slack
          .actOnMessage(
            workspace,
            boris,
            toBoris,
            ApproverMessageActionId.Approve,
          )
          .expect(200),
      ]),
    );
    await t.idle();

    for (const { request } of pairs) {
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Approved);
    }
    const notices = t.slackApi
      .postedMessages(workspace.token, member.slack_id)
      .filter((message) => textOf(message).includes('has been approved'));
    expect(notices).toHaveLength(pairs.length);
  });
  it('asks HR once when the last two managers approve at the same time', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const team = await workspace.addTeam({
      manager_approvers: [anna.slack_id, boris.slack_id],
      manager_approvers_rule: ApprovalRule.All,
      hr_approvers: [hr.slack_id],
    });
    const requester = await workspace.addUser({ team_id: team.id });
    const pairs: { toAnna: IPostedMessage; toBoris: IPostedMessage }[] = [];
    for (let week = 2; week <= 6; week += 1) {
      await requestVacation(t, workspace, requester, workWeek(week));
      await t.idle();
      const [toAnna] = t.slackApi
        .postedMessages(workspace.token, anna.slack_id)
        .slice(-1);
      const [toBoris] = t.slackApi
        .postedMessages(workspace.token, boris.slack_id)
        .slice(-1);
      pairs.push({ toAnna, toBoris });
    }

    await Promise.all(
      pairs.flatMap(({ toAnna, toBoris }) => [
        t.slack
          .actOnMessage(
            workspace,
            anna,
            toAnna,
            ApproverMessageActionId.Approve,
          )
          .expect(200),
        t.slack
          .actOnMessage(
            workspace,
            boris,
            toBoris,
            ApproverMessageActionId.Approve,
          )
          .expect(200),
      ]),
    );
    await t.idle();

    expect(
      t.slackApi.postedMessages(workspace.token, hr.slack_id),
    ).toHaveLength(pairs.length);
  });
});
