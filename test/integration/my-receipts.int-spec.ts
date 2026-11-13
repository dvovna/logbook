import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { MyReceiptsActionId } from '@modules/slack/tabs/my-receipts/enums/my-receipts-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  listItems,
  noticeOf,
  sectionTexts,
  titlesOf,
  actionIdsOf,
} from './support/tab-readers';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  seedReceipt,
  seedReimbursement,
  shareReceipt,
} from './support/receipts';

const MY_RECEIPTS = [NavigationActionId.MyReceipts];

const NO_MONEY_YET = (due: string) =>
  `Sport · June 2026: nothing sent yet · due ${due}`;

// Today is Wednesday 2026-06-17 (TEST_NOW), and Sport is due on the 5th: June's
// receipts are collected until 5 July.
describe('My receipts', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let member: Tables<'users'>;
  let other: Tables<'users'>;
  let sport: Tables<'reimbursements'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    member = await workspace.addUser({ name: 'Mia Member' });
    other = await workspace.addUser({ name: 'Otto Other' });
  });

  const seed = async (
    user: Tables<'users'>,
    fields: {
      fileName: string;
      amountCents?: number;
      status?: ReceiptStatus;
      month?: string;
      rejectionReason?: string;
    },
  ) => {
    const receipt = await seedReceipt(t, workspace, user, {
      reimbursement: sport,
      month: fields.month ?? '2026-06-01',
      amountCents: fields.amountCents ?? 2000,
      status: fields.status,
    });

    await t.db
      .updateTable('receipts')
      .set({
        file_name: fields.fileName,
        rejection_reason: fields.rejectionReason ?? null,
      })
      .where('id', '=', receipt.id)
      .execute();

    return receipt;
  };

  const receiptRow = async (id: string) =>
    (await workspace.rows('receipts')).find((row) => row.id === id);

  describe('on Home', () => {
    it('shows no Receipts section in a workspace without reimbursements', async () => {
      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home).join('\n')).not.toContain('Receipts');
      expect(actionIdsOf(home)).not.toContain(NavigationActionId.MyReceipts);
    });

    it('says nothing is sent yet, and when it is due', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });

      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home)).toEqual(
        expect.arrayContaining(['*🧾 Receipts*', NO_MONEY_YET('5 Jul')]),
      );
      expect(actionIdsOf(home)).toContain(NavigationActionId.MyReceipts);
    });

    it('counts the receipts waiting or accepted for the collected month, and the drafts', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      await seed(member, { fileName: 'a.pdf', amountCents: 2000 });
      await seed(member, {
        fileName: 'b.pdf',
        amountCents: 2550,
        status: ReceiptStatus.Accepted,
      });
      // Not counted: rejected, another month, and somebody else's.
      await seed(member, {
        fileName: 'c.pdf',
        status: ReceiptStatus.Rejected,
      });
      await seed(member, { fileName: 'd.pdf', month: '2026-05-01' });
      await seed(other, { fileName: 'e.pdf' });
      await shareReceipt(t, workspace, member, 'pdf', 'draft.pdf');

      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home)).toEqual(
        expect.arrayContaining([
          'Sport · June 2026: 2 receipts, $45.50 · due 5 Jul',
          '1 receipt needs details',
        ]),
      );
    });
  });

  describe('the screen', () => {
    it('lists only the viewer’s receipts, by month, and tells how to add one', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      await seed(member, { fileName: 'june.pdf' });
      await seed(member, { fileName: 'may.pdf', month: '2026-05-01' });
      await seed(other, { fileName: 'otto.pdf' });

      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);

      expect(titlesOf(tab)).toEqual(['june.pdf', 'may.pdf']);
      expect(sectionTexts(tab)).toContain(
        'Send a photo or PDF of a receipt to Logbook in Messages to add one.',
      );
      expect(listItems(tab)[0].fields).toEqual({
        Reimbursement: 'Sport',
        Amount: '$20.00',
        Status: '⏳ Waiting',
      });
    });

    it('keeps a receipt of the longest text people type within Slack’s 2000 characters a field', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      await seed(member, {
        fileName: `${'&<>'.repeat(40)}.pdf`,
        status: ReceiptStatus.Rejected,
        rejectionReason: '&'.repeat(500),
      });

      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);
      const [field] = (tab.blocks as { fields?: { text: string }[] }[]).flatMap(
        ({ fields }) => fields ?? [],
      );

      expect(field.text.length).toBeLessThanOrEqual(2000);
      expect(field.text).toContain('Reason: &amp;&amp;');
    });

    it('shows a rejection’s reason, and no menu on an accepted receipt', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      await seed(member, {
        fileName: 'rejected.pdf',
        status: ReceiptStatus.Rejected,
        rejectionReason: 'Not readable',
      });
      await seed(member, {
        fileName: 'accepted.pdf',
        status: ReceiptStatus.Accepted,
      });

      const items = listItems(
        await openAppHomeTab(t, workspace, member, MY_RECEIPTS),
      );
      const byTitle = (title: string) =>
        items.find((item) => item.title === title)!;

      expect(byTitle('rejected.pdf').fields).toEqual(
        expect.objectContaining({
          Status: '❌ Rejected',
          Reason: 'Not readable',
        }),
      );
      expect(byTitle('rejected.pdf').menu).toEqual([
        MyReceiptsActionId.EditReceipt,
        MyReceiptsActionId.DeleteReceipt,
      ]);
      expect(byTitle('accepted.pdf').menu).toEqual([]);
    });
  });

  describe('editing', () => {
    it('sends a rejected receipt to Finance again', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      const rejected = await seed(member, {
        fileName: 'rejected.pdf',
        status: ReceiptStatus.Rejected,
        rejectionReason: 'Not readable',
      });
      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);

      const form = await openModalFrom(
        t,
        workspace,
        member,
        tab,
        MyReceiptsActionId.ManageReceiptMenu,
        `${MyReceiptsActionId.EditReceipt}:${rejected.id}`,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, member, form, { amount: '30.00' })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      expect(await receiptRow(rejected.id)).toEqual(
        expect.objectContaining({
          status: ReceiptStatus.Submitted,
          amount_cents: 3000,
          rejection_reason: null,
        }),
      );
      expect(noticeOf(await publishedHome(t, workspace, member, since))).toBe(
        '✅ Receipt sent to Finance.',
      );
    });

    it('keeps the month of a rejected receipt that is no longer offered', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      // June is offered with May and April.
      const rejected = await seed(member, {
        fileName: 'february.pdf',
        month: '2026-02-01',
        status: ReceiptStatus.Rejected,
        rejectionReason: 'Wrong amount',
      });
      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);
      const form = await openModalFrom(
        t,
        workspace,
        member,
        tab,
        MyReceiptsActionId.ManageReceiptMenu,
        `${MyReceiptsActionId.EditReceipt}:${rejected.id}`,
      );
      const month = (
        form.blocks as {
          block_id?: string;
          element?: {
            options: { value: string }[];
            initial_option?: { value: string };
          };
        }[]
      ).find(({ block_id }) => block_id === 'month_block')!.element!;

      expect(month.options.map(({ value }) => value)).toEqual([
        '2026-06-01',
        '2026-05-01',
        '2026-04-01',
        '2026-02-01',
      ]);
      expect(month.initial_option?.value).toBe('2026-02-01');

      await t.slack
        .submitView(workspace, member, form, { amount: '12.00' })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      expect(await receiptRow(rejected.id)).toEqual(
        expect.objectContaining({
          status: ReceiptStatus.Submitted,
          month: '2026-02-01',
          amount_cents: 1200,
        }),
      );
    });

    describe('when its reimbursement is archived', () => {
      const archive = (reimbursement: Tables<'reimbursements'>) =>
        t.db
          .updateTable('reimbursements')
          .set({ archived_at: new Date().toISOString() })
          .where('id', '=', reimbursement.id)
          .execute();

      it('opens no form, and says so, when no reimbursement is active', async () => {
        sport = await seedReimbursement(t, workspace, { name: 'Sport' });
        const rejected = await seed(member, {
          fileName: 'rejected.pdf',
          status: ReceiptStatus.Rejected,
        });
        // Opened before: My receipts is reached from Home while one is.
        const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);
        await archive(sport);
        const since = t.slackApi.mark();

        await t.slack
          .actOnView(
            workspace,
            member,
            tab,
            MyReceiptsActionId.ManageReceiptMenu,
            `${MyReceiptsActionId.EditReceipt}:${rejected.id}`,
          )
          .expect(200);

        expect(noticeOf(await publishedHome(t, workspace, member, since))).toBe(
          '⚠️ There are no reimbursements to send receipts for yet.',
        );
        expect(
          t.slackApi.callsWith(workspace.token, 'views.open', { since }),
        ).toHaveLength(0);
      });

      it('offers the active ones, none chosen', async () => {
        sport = await seedReimbursement(t, workspace, { name: 'Sport' });
        const lunch = await seedReimbursement(t, workspace, { name: 'Lunch' });
        const rejected = await seed(member, {
          fileName: 'rejected.pdf',
          status: ReceiptStatus.Rejected,
        });
        await archive(sport);
        const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);

        const form = await openModalFrom(
          t,
          workspace,
          member,
          tab,
          MyReceiptsActionId.ManageReceiptMenu,
          `${MyReceiptsActionId.EditReceipt}:${rejected.id}`,
        );
        const select = (
          form.blocks as {
            block_id?: string;
            element?: {
              options: { value: string }[];
              initial_option?: unknown;
            };
          }[]
        ).find(({ block_id }) => block_id === 'reimbursement_block')!.element!;

        expect(select.options.map(({ value }) => value)).toEqual([lunch.id]);
        expect(select.initial_option).toBeUndefined();
      });
    });

    it('opens no form for an accepted receipt', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      const accepted = await seed(member, {
        fileName: 'accepted.pdf',
        status: ReceiptStatus.Accepted,
      });
      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);
      const since = t.slackApi.mark();

      await forgeMenu(
        member,
        tab,
        `${MyReceiptsActionId.EditReceipt}:${accepted.id}`,
      );

      expect(
        t.slackApi.callsWith(workspace.token, 'views.open', { since }),
      ).toHaveLength(0);
    });
  });

  describe('deleting', () => {
    it('removes the receipt after a confirmation', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      const waiting = await seed(member, { fileName: 'waiting.pdf' });
      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);

      const confirmation = await openModalFrom(
        t,
        workspace,
        member,
        tab,
        MyReceiptsActionId.ManageReceiptMenu,
        `${MyReceiptsActionId.DeleteReceipt}:${waiting.id}`,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, member, confirmation)
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      expect(await receiptRow(waiting.id)).toBeUndefined();
      const shown = await publishedHome(t, workspace, member, since);

      expect(noticeOf(shown)).toBe('✅ Receipt deleted.');
      expect(titlesOf(shown)).toEqual([]);
    });
  });

  describe('with an ID that is not the viewer’s', () => {
    it('changes nothing and opens no form', async () => {
      sport = await seedReimbursement(t, workspace, { name: 'Sport' });
      const theirs = await seed(other, { fileName: 'otto.pdf' });
      await seed(member, { fileName: 'mine.pdf' });
      const tab = await openAppHomeTab(t, workspace, member, MY_RECEIPTS);
      const since = t.slackApi.mark();

      for (const action of [
        MyReceiptsActionId.DeleteReceipt,
        MyReceiptsActionId.EditReceipt,
      ]) {
        await forgeMenu(member, tab, `${action}:${theirs.id}`);
      }

      expect(
        t.slackApi.callsWith(workspace.token, 'views.open', { since }),
      ).toHaveLength(0);
      expect(await receiptRow(theirs.id)).toEqual(
        expect.objectContaining({ status: ReceiptStatus.Submitted }),
      );
    });
  });

  // A choice in a receipt's menu that the screen did not offer.
  const forgeMenu = async (
    user: Tables<'users'>,
    view: View,
    value: string,
  ) => {
    await t.slack.interaction({
      type: 'block_actions',
      team: { id: workspace.slackId },
      user: { id: user.slack_id, team_id: workspace.slackId },
      trigger_id: 'trigger-forged',
      container: { type: 'view' },
      view: { team_id: workspace.slackId, ...view },
      actions: [
        {
          type: 'overflow',
          block_id: 'forged',
          action_id: MyReceiptsActionId.ManageReceiptMenu,
          action_ts: '1',
          selected_option: {
            text: { type: 'plain_text', text: value },
            value,
          },
        },
      ],
    });
    await t.idle();
  };
});
