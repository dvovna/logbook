import { randomUUID } from 'crypto';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { IPostedMessage } from './support/fake-slack-api.client';
import { actionIdsOf } from './support/tab-readers';
import { travelTo } from './support/clock';
import { clickInMessage } from './support/team-file';
import {
  balancesCsv,
  historyCsv,
  leaveFileTexts,
  shareLeaveFile,
} from './support/leave-file';

// Today is Wednesday 2026-06-17 (TEST_NOW).
describe('Leave file Undo', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let anna: Tables<'users'>;
  let bo: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const policy = await workspace.addVacationPolicy({
      vacation_days: 26,
      working_days: 20,
      carryover_days: 5,
      bonus_days: 3,
    });
    const team = await workspace.addTeam({ vacation_policy_id: policy.id });
    [anna, bo] = await Promise.all(
      ['Anna Novak', 'Bo Brown'].map((name) =>
        workspace.addUser({
          name,
          team_id: team.id,
          created_at: '2026-01-01T09:00:00Z',
        }),
      ),
    );
  });

  const click = (message: IPostedMessage, action: string) =>
    clickInMessage(t, workspace, hr, message, action);
  // Shares and applies a file; returns the preview message carrying the
  // result's blocks, which hold the Undo button.
  const apply = async (content: string, fileName: string) => {
    const [preview] = await shareLeaveFile(t, workspace, hr, content, fileName);
    const result = await click(preview, 'apply');

    return { ...preview, blocks: result!.blocks as IPostedMessage['blocks'] };
  };
  const applyHistory = (...lines: string[]) =>
    apply(historyCsv(...lines), 'leave-history.csv');
  const applyBalances = (...lines: string[]) =>
    apply(balancesCsv(...lines), 'leave-balances.csv');
  const told = (since: number) =>
    t.slackApi
      .ephemeralMessages(workspace.token, hr.slack_id, { since })
      .map(({ text }) => text);
  const leaves = async () =>
    (await workspace.rows('vacation_requests'))
      .map(({ start_date, end_date }) => `${start_date}..${end_date}`)
      .sort();
  // As an edit in Logbook leaves a request: another comment, a newer time.
  const editRequest = (startDate: string) =>
    t.db
      .updateTable('vacation_requests')
      .set({
        user_comment: 'Moved by HR',
        updated_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .where('slack_team_id', '=', workspace.id)
      .where('start_date', '=', startDate)
      .execute();
  const balances = async () =>
    (await workspace.rows('leave_balances'))
      .map(({ user_id, balance_on, days_left, upload_id }) => ({
        user_id,
        balance_on,
        days_left,
        upload_id,
      }))
      .sort((a, b) => a.user_id.localeCompare(b.user_id));

  it("a history's Undo removes its leaves and keeps one edited since, naming it", async () => {
    const applied = await applyHistory(
      `Anna Novak,${anna.email},Annual leave,2026-04-06,2026-04-10,`,
      `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
      `Bo Brown,${bo.email},Sick leave,2026-05-04,2026-05-05,`,
    );
    await editRequest('2026-07-06');

    const update = await click(applied, 'undo');

    expect(update!.text).toBe('↩️ Undone: 2 changes restored.');
    expect(leaveFileTexts(update)).toEqual([
      [
        '↩️ Undone: 2 changes restored.',
        'Kept, because they changed since:',
        "• Anna Novak's annual leave 6–10 Jul 2026",
      ].join('\n'),
    ]);
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await leaves()).toEqual(['2026-07-06..2026-07-10']);
    const [upload] = await workspace.rows('leave_file_uploads');
    expect(upload).toMatchObject({
      status: 'undone',
      undone_at: expect.any(String),
    });
  });

  it("a balances file's Undo puts back the earlier balance and contract start, and keeps one changed since", async () => {
    await applyBalances(
      `Anna Novak,${anna.email},,2026-06-17,12,,`,
      `Bo Brown,${bo.email},,2026-06-17,10,,`,
    );
    const [first] = await workspace.rows('leave_file_uploads');
    const second = await applyBalances(
      `Anna Novak,${anna.email},2021-04-15,2026-06-17,8,,`,
      `Bo Brown,${bo.email},,2026-06-17,9,,`,
    );
    await t.db
      .updateTable('leave_balances')
      .set({
        days_left: 7,
        updated_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .where('user_id', '=', bo.id)
      .execute();

    const update = await click(second, 'undo');

    expect(leaveFileTexts(update)).toEqual([
      [
        '↩️ Undone: 2 changes restored.',
        'Kept, because they changed since:',
        "• Bo Brown's balance",
      ].join('\n'),
    ]);
    expect(await balances()).toEqual(
      [
        {
          user_id: anna.id,
          balance_on: '2026-06-17',
          days_left: 12,
          upload_id: first.id,
        },
        {
          user_id: bo.id,
          balance_on: '2026-06-17',
          days_left: 7,
          upload_id: expect.any(String),
        },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
    expect((await workspace.row('users', anna.id)).contract_start_date).toBe(
      null,
    );
  });

  it('Undo more than 7 days later says so and changes nothing', async () => {
    const applied = await applyHistory(
      `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
    );
    travelTo('2026-06-25');
    const since = t.slackApi.mark();

    await click(applied, 'undo');

    expect(told(since)).toEqual([
      "This file can't be undone: it's been more than 7 days.",
    ]);
    expect(await leaves()).toEqual(['2026-05-04..2026-05-05']);
  });

  it('an older upload is undone after a newer one was applied', async () => {
    const older = await applyHistory(
      `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
    );
    await applyHistory(
      `Bo Brown,${bo.email},Sick leave,2026-05-11,2026-05-12,`,
    );

    const update = await click(older, 'undo');

    expect(leaveFileTexts(update)).toEqual(['↩️ Undone: 1 change restored.']);
    expect(await leaves()).toEqual(['2026-05-11..2026-05-12']);
  });

  it('a second Undo says it was already undone, and two at once undo once', async () => {
    const applied = await applyHistory(
      `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
    );

    await Promise.all(
      [1, 2].map(() =>
        t.slack.actOnMessage(workspace, hr, applied, 'undo').expect(200),
      ),
    );
    await t.idle();
    const since = t.slackApi.mark();
    await click(applied, 'undo');

    expect(told(since)).toEqual([
      "This file can't be undone: it was already undone.",
    ]);
    expect(
      t.slackApi
        .messageUpdates(workspace.token, applied)
        .map((update) => leaveFileTexts(update)[0]),
    ).toEqual([
      '✅ Added 1 leave for 1 person.',
      '↩️ Undone: 1 change restored.',
    ]);
  });

  it('a forged Undo of no upload of the workspace changes nothing', async () => {
    const applied = await applyHistory(
      `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
    );
    const other = await t.createWorkspace();
    const otherHr = await other.addUser({ role: UserRole.HR });
    const since = t.slackApi.mark();
    const forged = (value: string) => ({
      ...applied,
      blocks: [
        {
          type: 'actions',
          block_id: ViewCallbackId.LeaveFileMessage,
          elements: [
            {
              type: 'button',
              action_id: 'undo',
              text: { type: 'plain_text', text: 'Undo' },
              value,
            },
          ],
        },
      ],
    });

    await click(forged(`undo:${randomUUID()}`), 'undo');
    await click(forged('undo:not-an-id'), 'undo');
    await t.slack.actOnMessage(other, otherHr, applied, 'undo').expect(200);
    await t.idle();

    expect(told(since)).toEqual(
      Array(2).fill('This Undo is no longer available. Nothing changed.'),
    );
    expect(
      t.slackApi
        .ephemeralMessages(other.token, otherHr.slack_id, { since })
        .map(({ text }) => text),
    ).toEqual(['This Undo is no longer available. Nothing changed.']);
    expect(await leaves()).toEqual(['2026-05-04..2026-05-05']);
    expect((await workspace.rows('leave_file_uploads'))[0].status).toBe(
      'applied',
    );
  });
});
