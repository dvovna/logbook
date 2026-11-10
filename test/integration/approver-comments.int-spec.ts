import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { RequesterNoticeActionId } from '@modules/slack/tabs/vacation-requests/enums/requester-notice-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { IPostedMessage } from './support/fake-slack-api.client';
import { workWeek } from './support/dates';
import { actionIdsOf, noticeOf, sectionTexts } from './support/tab-readers';
import { publishedHome } from './support/app-home';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

// An approver comments on a request from the approval message; the other
// approvers see the comment in theirs.
describe('Approver comments', () => {
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
      manager_approvers_rule: ApprovalRule.All,
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  // The latest version of a message the app posted.
  const latest = (message: IPostedMessage) =>
    textOf(
      t.slackApi.messageUpdates(workspace.token, message).pop() ?? message,
    );

  const comment = async (
    approver: Tables<'users'>,
    message: IPostedMessage,
    text: string,
  ) => {
    const since = t.slackApi.mark();
    await t.slack
      .actOnMessage(
        workspace,
        approver,
        message,
        ApproverMessageActionId.AddComment,
      )
      .expect(200);
    await t.idle();
    const form = t.slackApi.openedModal(workspace.token, { since });

    return t.slack
      .submitView(workspace, approver, form, { comment: text })
      .expect(200);
  };

  it("shows a comment in every pending approver's message", async () => {
    const request = await requestVacation(t, workspace, member, workWeek(2));
    const toAnna = await approvalMessageTo(t, workspace, anna);
    const toBoris = await approvalMessageTo(t, workspace, boris);

    const response = await comment(
      anna,
      toAnna,
      'Is this in the release week?',
    );
    await t.idle();

    // The form closes; the comment shows in the approvers' messages.
    expect(response.body).toEqual({ response_action: 'clear' });
    expect(await workspace.rows('request_workflow_step_comments')).toEqual([
      expect.objectContaining({
        request_id: request.id,
        slack_user_id: anna.slack_id,
        comment: 'Is this in the release week?',
        step_level: 1,
      }),
    ]);
    expect(latest(toAnna)).toContain('Is this in the release week?');
    expect(latest(toBoris)).toContain('Is this in the release week?');
  });

  it('keeps the comments once the request is decided', async () => {
    await requestVacation(t, workspace, member, workWeek(2));
    const toAnna = await approvalMessageTo(t, workspace, anna);
    const toBoris = await approvalMessageTo(t, workspace, boris);
    await comment(boris, toBoris, 'Fine by me');

    for (const [approver, message] of [
      [anna, toAnna],
      [boris, toBoris],
    ] as const) {
      await t.slack
        .actOnMessage(
          workspace,
          approver,
          message,
          ApproverMessageActionId.Approve,
        )
        .expect(200);
      await t.idle();
    }

    expect(latest(toAnna)).toContain('Approved by');
    expect(latest(toAnna)).toContain('Fine by me');
  });

  it('asks for a comment instead of failing on a blank one', async () => {
    await requestVacation(t, workspace, member, workWeek(2));
    const toAnna = await approvalMessageTo(t, workspace, anna);

    const response = await comment(anna, toAnna, '   ');

    expect(response.body).toEqual({
      response_action: 'errors',
      errors: { comment_block: 'Comment is required' },
    });
  });

  describe('the requester', () => {
    const commentNotices = (user: Tables<'users'>) =>
      t.slackApi
        .postedMessages(workspace.token, user.slack_id)
        .filter((message) =>
          textOf(message).includes('commented on your vacation request'),
        );

    const click = async (
      user: Tables<'users'>,
      message: IPostedMessage,
      actionId: RequesterNoticeActionId,
    ) => {
      const since = t.slackApi.mark();
      await t.slack
        .actOnMessage(workspace, user, message, actionId)
        .expect(200);
      await t.idle();

      return t.slackApi.callsWith(workspace.token, 'views.open', { since });
    };

    it('hears of a comment at once, with the request a click away', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const toAnna = await approvalMessageTo(t, workspace, anna);

      await comment(anna, toAnna, 'Can you move it a week earlier?');
      await t.idle();

      const [notice, ...more] = commentNotices(member);
      expect(more).toEqual([]);
      expect(textOf(notice)).toContain(
        `<@${anna.slack_id}> commented on your vacation request`,
      );
      expect(textOf(notice)).toContain('>Can you move it a week earlier?');
      expect(actionIdsOf(notice)).toEqual([
        RequesterNoticeActionId.ViewDetails,
        RequesterNoticeActionId.CancelRequest,
      ]);

      // View Details shows the request with the comment.
      let since = t.slackApi.mark();
      await click(member, notice, RequesterNoticeActionId.ViewDetails);
      expect(
        textOf(t.slackApi.openedModal(workspace.token, { since })),
      ).toContain('Can you move it a week earlier?');

      // Cancel asks first, then cancels the request and says so on Home.
      since = t.slackApi.mark();
      await click(member, notice, RequesterNoticeActionId.CancelRequest);
      const form = t.slackApi.openedModal(workspace.token, { since });
      since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, member, form)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, member, since))).toBe(
        '✅ Vacation request canceled.',
      );
      expect(
        (await workspace.row('vacation_requests', request.id)).status,
      ).toBe(VacationRequestStatus.Canceled);
    });

    it('reads the comment as typed, not as mrkdwn', async () => {
      await requestVacation(t, workspace, member, workWeek(2));
      const toAnna = await approvalMessageTo(t, workspace, anna);

      await comment(anna, toAnna, '<!here> see <https://evil.test|this>');
      await t.idle();

      const [notice] = commentNotices(member);
      expect(textOf(notice)).toContain(
        '&lt;!here&gt; see &lt;https://evil.test|this&gt;',
      );
      expect(textOf(notice)).not.toContain('<!here>');
    });

    // The request ID in a button comes from the client.
    it("can't open or cancel a teammate's request from the notice", async () => {
      const teammate = await workspace.addUser({
        team_id: member.team_id,
        name: 'Tina Teammate',
      });
      const theirs = await requestVacation(t, workspace, teammate, workWeek(4));
      await requestVacation(t, workspace, member, workWeek(2));
      await t.idle();
      const toAnna = t.slackApi
        .postedMessages(workspace.token, anna.slack_id)
        .find((message) => textOf(message).includes('Max Member'))!;
      await comment(anna, toAnna, 'Which project is this for?');
      await t.idle();
      const [notice] = commentNotices(member);

      // As Slack would send it if the client changed the button's value.
      const clickForged = async (
        actionId: RequesterNoticeActionId,
        status: number,
      ) => {
        const since = t.slackApi.mark();
        await t.slack
          .interaction({
            type: 'block_actions',
            team: { id: workspace.slackId },
            user: { id: member.slack_id, team_id: workspace.slackId },
            trigger_id: 'trigger-forged',
            container: { type: 'message', message_ts: notice.ts },
            channel: { id: notice.channel },
            message: {
              ts: notice.ts,
              text: notice.text,
              blocks: notice.blocks,
            },
            actions: [
              {
                type: 'button',
                action_id: actionId,
                block_id: 'requester_notice_message',
                value: `${actionId}:${theirs.id}`,
                action_ts: '1',
              },
            ],
          })
          .expect(status);
        await t.idle();

        return since;
      };

      // Refused (403, as from Home's menu), and no details open.
      const viewSince = await clickForged(
        RequesterNoticeActionId.ViewDetails,
        403,
      );
      expect(
        t.slackApi.callsWith(workspace.token, 'views.open', {
          since: viewSince,
        }),
      ).toEqual([]);

      // The confirmation opens, as from Home; canceling is refused.
      const cancelSince = await clickForged(
        RequesterNoticeActionId.CancelRequest,
        200,
      );
      const response = await t.slack
        .submitView(
          workspace,
          member,
          t.slackApi.openedModal(workspace.token, { since: cancelSince }),
        )
        .expect(200);

      expect(response.body.response_action).toBe('update');
      expect((await workspace.row('vacation_requests', theirs.id)).status).toBe(
        VacationRequestStatus.Pending,
      );
    });
  });
});
