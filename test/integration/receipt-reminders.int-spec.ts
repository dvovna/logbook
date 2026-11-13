import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { ReceiptRemindersService } from '@modules/slack/receipts/services/receipt-reminders.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { publishedHome } from './support/app-home';
import { clickInMessage, messageTexts } from './support/team-file';
import {
  seedReceipt,
  seedReimbursement,
  shareReceipt,
} from './support/receipts';
import { actionIdsOf } from './support/tab-readers';
import { travelTo } from './support/clock';

const OPENED =
  '🧾 Receipts for *Sport* for October 2026 are due by 4 November. Send a photo or PDF here.';
const DUE =
  '🧾 Receipts for *Sport* for October 2026 are due tomorrow, 4 November.';
const DRAFT = 'You have 1 receipt that still needs details.';

describe('Receipt reminders', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let sport: Tables<'reimbursements'>;
  let reminders: ReceiptRemindersService;
  let finance: Tables<'users'>;
  let admin: Tables<'users'>;
  let hr: Tables<'users'>;
  let sent: Tables<'users'>;
  let optedOut: Tables<'users'>;
  let inactive: Tables<'users'>;
  let nothing: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
    reminders = t.app.get(ReceiptRemindersService);
  });

  afterAll(() => t.close());

  const createdAt = (date: string) =>
    t.db
      .updateTable('reimbursements')
      .set({ created_at: `${date}T10:00:00Z` })
      .where('id', '=', sport.id)
      .execute();

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    finance = await workspace.addUser({
      name: 'Fay Finance',
      role: UserRole.Finance,
    });
    admin = await workspace.addUser({
      name: 'Alex Admin',
      role: UserRole.Admin,
    });
    hr = await workspace.addUser({ name: 'Hana HR', role: UserRole.HR });
    sent = await workspace.addUser({ name: 'Sam Sent' });
    optedOut = await workspace.addUser({ name: 'Olga Out' });
    inactive = await workspace.addUser({ name: 'Ivan Gone', is_active: false });
    nothing = await workspace.addUser({ name: 'Nina Nothing' });
    sport = await seedReimbursement(t, workspace, {
      name: 'Sport',
      dueDay: 4,
    });
    await createdAt('2026-10-01');
    await seedReceipt(t, workspace, sent, {
      reimbursement: sport,
      month: '2026-10-01',
      amountCents: 4000,
    });
    await t.db
      .insertInto('reimbursement_opt_outs')
      .values({
        slack_team_id: workspace.id,
        user_id: optedOut.id,
        reimbursement_id: sport.id,
      })
      .execute();
  });

  const dms = (user: Tables<'users'>, since = 0) =>
    t.slackApi.shownMessages(workspace.token, user.slack_id, { since });

  const remind = async (date: string) => {
    travelTo(date);
    const since = t.slackApi.mark();

    await reminders.remindAll();
    await t.idle();

    return since;
  };

  it('opens the month for whoever sent nothing, once', async () => {
    const since = await remind('2026-11-01');

    expect(messageTexts(dms(nothing, since)[0])).toEqual([OPENED]);
    expect(actionIdsOf(dms(nothing, since)[0] as never)).toEqual([
      ReceiptActionId.NoReminders,
    ]);

    // Everyone active who sent nothing, whatever their role.
    for (const user of [hr, finance]) {
      expect(messageTexts(dms(user, since)[0])).toEqual([OPENED]);
    }

    for (const user of [sent, optedOut, inactive]) {
      expect(dms(user, since)).toEqual([]);
    }
  });

  it('sends nothing more on the next tick or from a second app', async () => {
    const since = await remind('2026-11-01');
    const second = await createTestApp({ slackApi: t.slackApi });

    try {
      await reminders.remindAll();
      await second.app.get(ReceiptRemindersService).remindAll();
      await t.idle();
      await second.idle();

      expect(dms(nothing, since)).toHaveLength(1);
    } finally {
      await second.close();
    }
  });

  it('"I don\'t use this" opts out, replaces the message and skips the due day', async () => {
    const since = await remind('2026-11-01');
    const [message] = dms(nothing, since);

    const updated = await clickInMessage(
      t,
      workspace,
      nothing,
      message,
      ReceiptActionId.NoReminders,
    );

    expect(messageTexts(updated)).toEqual([
      "🔕 You won't be reminded about Sport. Turn it back on in Home → 🔔 Reminders.",
    ]);
    expect(
      (await workspace.rows('reimbursement_opt_outs')).map(
        ({ user_id }) => user_id,
      ),
    ).toEqual(expect.arrayContaining([nothing.id]));

    const dueSince = await remind('2026-11-03');

    expect(dms(nothing, dueSince)).toEqual([]);
  });

  it('reminds the day before the due date, with the draft line when there is one', async () => {
    const [draftMessage] = await shareReceipt(
      t,
      workspace,
      sent,
      'gym',
      'g.pdf',
    );
    const withDraft = await workspace.addUser({ name: 'Dora Draft' });

    await shareReceipt(t, workspace, withDraft, 'lunch', 'l.pdf');

    const since = await remind('2026-11-03');

    expect(draftMessage).toBeDefined();
    expect(messageTexts(dms(nothing, since)[0])).toEqual([DUE]);
    expect(messageTexts(dms(sent, since)[0])).toEqual([
      '🧾 You have 1 receipt that still needs details. Receipts for *Sport* for October 2026 are due tomorrow, 4 November.',
    ]);
    expect(messageTexts(dms(withDraft, since)[0])).toEqual([
      `${DUE}\n${DRAFT}`,
    ]);
    expect(dms(optedOut, since)).toEqual([]);
    expect(messageTexts(dms(hr, since)[0])).toEqual([DUE]);
  });

  describe('the summary', () => {
    it('reaches Admin and Finance, not HR, and Open receipts shows the month', async () => {
      const since = await remind('2026-11-05');
      const [message] = dms(finance, since);

      expect(messageTexts(message)).toEqual([
        '🧾 *Sport*, October 2026: 1 of 5 people sent receipts, 1 waiting for you.',
      ]);
      expect(messageTexts(dms(admin, since)[0])).toEqual([
        '🧾 *Sport*, October 2026: 1 of 5 people sent receipts, 1 waiting for you.',
      ]);
      expect(dms(hr, since)).toEqual([]);
      expect(dms(nothing, since)).toEqual([]);

      const clicked = t.slackApi.mark();
      const updated = await clickInMessage(
        t,
        workspace,
        finance,
        message,
        ReceiptActionId.OpenReceipts,
      );

      expect(messageTexts(updated)).toEqual([
        "🧾 *Sport*, October 2026: 1 of 5 people sent receipts, 1 waiting for you.\nOpen Logbook's Home to see them.",
      ]);
      expect(
        JSON.stringify(await publishedHome(t, workspace, finance, clicked)),
      ).toContain('Sport');
    });

    it('refuses Open receipts from someone who is not Admin or Finance', async () => {
      const since = await remind('2026-11-05');
      const [message] = dms(finance, since);
      const clicked = t.slackApi.mark();

      await t.slack
        .actOnMessage(workspace, sent, message, ReceiptActionId.OpenReceipts)
        .expect(200);
      await t.idle();

      expect(
        t.slackApi.callsWith(workspace.token, 'views.publish', {
          since: clicked,
        }),
      ).toEqual([]);
    });

    it('is not sent for a month with no receipts when nobody is left to send', async () => {
      await t.db
        .deleteFrom('receipts')
        .where('slack_team_id', '=', workspace.id)
        .execute();
      await t.db
        .insertInto('reimbursement_opt_outs')
        .values(
          [admin, finance, hr, sent, nothing].map((user) => ({
            slack_team_id: workspace.id,
            user_id: user.id,
            reimbursement_id: sport.id,
          })),
        )
        .execute();

      const since = await remind('2026-11-05');

      expect(dms(finance, since)).toEqual([]);
    });
  });

  it('sends nothing for a month before the reimbursement existed', async () => {
    await createdAt('2026-11-20');

    const since = await remind('2026-11-05');

    for (const user of [finance, nothing]) {
      expect(dms(user, since)).toEqual([]);
    }
  });

  it('skips someone who sent after the reminders were saved', async () => {
    t.slackApi.failNextTo(nothing.slack_id);
    const since = await remind('2026-11-01');

    await seedReceipt(t, workspace, nothing, {
      reimbursement: sport,
      month: '2026-10-01',
      amountCents: 1000,
    });
    await t.retryJobs();
    await t.idle();

    expect(dms(nothing, since)).toEqual([]);
  });

  it('skips a reimbursement archived after the reminders were saved', async () => {
    t.slackApi.failNextTo(nothing.slack_id);
    const since = await remind('2026-11-01');

    await t.db
      .updateTable('reimbursements')
      .set({ archived_at: new Date().toISOString() })
      .where('id', '=', sport.id)
      .execute();
    await t.retryJobs();
    await t.idle();

    expect(dms(nothing, since)).toEqual([]);
  });

  it('is retried when Slack fails the first time', async () => {
    t.slackApi.failNextTo(nothing.slack_id);
    const since = await remind('2026-11-01');

    expect(dms(nothing, since)).toEqual([]);

    await t.retryJobs();
    await t.idle();

    expect(messageTexts(dms(nothing, since)[0])).toEqual([OPENED]);
    expect(dms(nothing, since)).toHaveLength(1);
  });
});
