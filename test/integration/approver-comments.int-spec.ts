import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { IPostedMessage } from './support/fake-slack-api.client';
import { workWeek } from './support/dates';
import { sectionTexts } from './support/tab-readers';
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

    expect(sectionTexts(response.body.view)).toEqual([
      '✅ Comment was created successfully!',
    ]);
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
});
