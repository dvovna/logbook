import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actionIdsOf,
  listCount,
  listItems,
  noticeOf,
  sectionTexts,
  titlesOf,
} from './support/tab-readers';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { seedReceipt, seedReimbursement } from './support/receipts';

const RECEIPTS = [NavigationActionId.Receipts];

// Today is Wednesday 2026-06-17 (TEST_NOW), and Sport is due on the 5th: June's
// receipts are collected until 5 July.
describe('The Receipts screen', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let finance: Tables<'users'>;
  let anna: Tables<'users'>;
  let oleg: Tables<'users'>;
  let sport: Tables<'reimbursements'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    finance = await workspace.addUser({
      role: UserRole.Finance,
      name: 'Fay Finance',
    });
    anna = await workspace.addUser({ name: 'Anna Kim' });
    oleg = await workspace.addUser({ name: 'Oleg Sidorov' });
    sport = await seedReimbursement(t, workspace, {
      name: 'Sport',
      limitCents: 5000,
    });
  });

  const seed = async (
    user: Tables<'users'>,
    fields: {
      fileName: string;
      amountCents: number;
      status?: ReceiptStatus;
      month?: string;
      content?: Buffer;
      submittedAt?: string;
    },
  ) => {
    const receipt = await seedReceipt(t, workspace, user, {
      reimbursement: sport,
      month: fields.month ?? '2026-06-01',
      amountCents: fields.amountCents,
      status: fields.status,
      content: fields.content,
    });

    await t.db
      .updateTable('receipts')
      .set({
        file_name: fields.fileName,
        ...(fields.submittedAt ? { submitted_at: fields.submittedAt } : {}),
      })
      .where('id', '=', receipt.id)
      .execute();

    return receipt;
  };

  const receiptRow = async (id: string) =>
    (await workspace.rows('receipts')).find((row) => row.id === id)!;

  const open = () => openAppHomeTab(t, workspace, finance, RECEIPTS);

  describe('a month', () => {
    it('shows who sent what, and the people who sent nothing', async () => {
      await seed(anna, { fileName: 'gym-june.pdf', amountCents: 3000 });
      await seed(anna, {
        fileName: 'pool.jpg',
        amountCents: 1500,
        status: ReceiptStatus.Accepted,
      });
      await seed(oleg, {
        fileName: 'club.pdf',
        amountCents: 6000,
        status: ReceiptStatus.Accepted,
      });
      await workspace.addUser({ name: 'Ivan Petrov' });
      await seed(anna, {
        fileName: 'draft.pdf',
        amountCents: 100,
        status: ReceiptStatus.Draft,
      });

      const tab = await open();

      expect(sectionTexts(tab)).toEqual([
        '*🧾 Receipts* · Sport · June 2026',
        '2 of 4 people sent receipts · 1 waiting · due 5 Jul',
        '*Anna Kim* · $45.00 of $50.00',
        '*Oleg Sidorov* · $60.00 of $50.00 ⚠️ over the limit',
        'Sent nothing: Fay Finance, Ivan Petrov',
      ]);
      expect(
        listItems(tab).map(({ title, fields, buttons, menu, menuLabels }) => ({
          title,
          fields,
          buttons,
          menu,
          menuLabels,
        })),
      ).toEqual([
        {
          title: 'gym-june.pdf',
          fields: { Amount: '$30.00', Status: '⏳ Waiting' },
          buttons: [
            ReceiptsTabActionId.AcceptReceipt,
            ReceiptsTabActionId.RejectReceipt,
          ],
          menu: [],
          menuLabels: [],
        },
        {
          title: 'pool.jpg',
          fields: { Amount: '$15.00', Status: '✅ Accepted' },
          buttons: [],
          menu: [ReceiptsTabActionId.RejectReceipt],
          menuLabels: ['Reject'],
        },
        {
          title: 'club.pdf',
          fields: { Amount: '$60.00', Status: '✅ Accepted' },
          buttons: [],
          menu: [ReceiptsTabActionId.RejectReceipt],
          menuLabels: ['Reject'],
        },
      ]);
    });

    it('marks a late receipt, the same file from two people, and a deactivated person', async () => {
      const file = Buffer.from('the same photo');

      await seed(anna, {
        fileName: 'taxi.pdf',
        amountCents: 2000,
        month: '2026-05-01',
        content: file,
        submittedAt: '2026-06-17T08:00:00.000Z',
      });
      await seed(oleg, {
        fileName: 'taxi-copy.pdf',
        amountCents: 2000,
        month: '2026-05-01',
        content: file,
        submittedAt: '2026-06-05T08:00:00.000Z',
      });
      await t.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', oleg.id)
        .execute();

      const may = await actOnTab(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.PreviousMonth,
        '2026-05-01',
      );

      expect(sectionTexts(may)).toContain(
        '*Oleg Sidorov* (deactivated) · $20.00 of $50.00',
      );
      expect(
        listItems(may).map(({ title, fields }) => [title, fields]),
      ).toEqual([
        ['taxi.pdf', { Amount: '$20.00', Status: '⏳ Waiting' }],
        ['taxi-copy.pdf', { Amount: '$20.00', Status: '⏳ Waiting' }],
      ]);
      expect(
        JSON.stringify(may.blocks).match(/⏰ Late|Same file as [^"\\]+/g),
      ).toEqual([
        '⏰ Late',
        'Same file as Oleg Sidorov',
        'Same file as Anna Kim',
      ]);
    });

    it('shows the next month empty', async () => {
      await seed(anna, { fileName: 'gym-june.pdf', amountCents: 3000 });

      const july = await actOnTab(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.NextMonth,
        '2026-07-01',
      );

      expect(sectionTexts(july)).toEqual([
        '*🧾 Receipts* · Sport · July 2026',
        '0 of 3 people sent receipts · 0 waiting · due 5 Aug',
        '_No receipts for this month yet._',
        'Sent nothing: Anna Kim, Fay Finance, Oleg Sidorov',
      ]);
      expect(titlesOf(july)).toEqual([]);
    });

    it('lets Finance choose among several reimbursements', async () => {
      const lunch = await seedReimbursement(t, workspace, { name: 'Lunch' });
      await seedReceipt(t, workspace, anna, {
        reimbursement: lunch,
        month: '2026-06-01',
        amountCents: 900,
      });

      const first = await open();

      // The first by name.
      expect(sectionTexts(first)[0]).toBe('*🧾 Receipts* · Lunch · June 2026');
      expect(actionIdsOf(first)).toContain(
        ReceiptsTabActionId.SelectReimbursement,
      );

      const sportTab = await actOnTab(
        t,
        workspace,
        finance,
        first,
        ReceiptsTabActionId.SelectReimbursement,
        sport.id,
      );

      expect(sectionTexts(sportTab)[0]).toBe(
        '*🧾 Receipts* · Sport · June 2026',
      );
    });

    it('says so, and offers the reimbursements, when there are none', async () => {
      await t.db
        .updateTable('reimbursements')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', sport.id)
        .execute();

      const tab = await open();

      expect(sectionTexts(tab)).toEqual([
        '*🧾 Receipts*',
        'There are no reimbursements yet. Add one to start collecting receipts.',
      ]);
      expect(actionIdsOf(tab)).toContain(
        ReceiptsTabActionId.OpenReimbursements,
      );
    });

    it('pages through the people, and keeps a page within Slack’s 100 blocks', async () => {
      for (let i = 1; i <= 23; i++) {
        const person = await workspace.addUser({
          name: `Person ${String(i).padStart(2, '0')}`,
        });

        for (let n = 1; n <= 4; n++) {
          await seed(person, {
            fileName: `p${i}-${n}.pdf`,
            amountCents: 100,
          });
        }
      }
      const first = await open();

      expect(listCount(first)).toBe('1–10 of 23');
      expect((first.blocks as { type: string }[]).length).toBeLessThanOrEqual(
        100,
      );
      expect(sectionTexts(first)).toContain('*Person 01* · $4.00 of $50.00');

      const second = await actOnTab(
        t,
        workspace,
        finance,
        first,
        ReceiptsTabActionId.PaginationNext,
        '2',
      );

      expect(listCount(second)).toBe('11–20 of 23');

      const third = await actOnTab(
        t,
        workspace,
        finance,
        second,
        ReceiptsTabActionId.PaginationNext,
        '3',
      );

      expect(listCount(third)).toBe('21–23 of 23');
      expect(sectionTexts(third)).toContain('*Person 23* · $4.00 of $50.00');
    });
  });

  describe('a person’s receipts', () => {
    const blocksOf = (view: View) => (view.blocks as unknown[]).length;

    const people = async (counts: number[]) => {
      const users: Tables<'users'>[] = [];

      for (const [i, count] of counts.entries()) {
        const person = await workspace.addUser({
          name: `Person ${String(i + 1).padStart(2, '0')}`,
        });

        for (let n = 1; n <= count; n++) {
          await seed(person, {
            fileName: `p${i + 1}-${n}.pdf`,
            amountCents: 100,
          });
        }
        users.push(person);
      }

      return users;
    };

    const showAll = (view: View, person: Tables<'users'>) =>
      actOnTab(
        t,
        workspace,
        finance,
        view,
        ReceiptsTabActionId.ShowPerson,
        person.id,
      );

    // A button the screen did not offer.
    const forgeShowPerson = async (view: View, personId: string) => {
      const since = t.slackApi.mark();

      await t.slack.interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: finance.slack_id, team_id: workspace.slackId },
        trigger_id: 'trigger-forged',
        container: { type: 'view' },
        view: { team_id: workspace.slackId, ...view },
        actions: [
          {
            type: 'button',
            action_id: ReceiptsTabActionId.ShowPerson,
            block_id: 'forged',
            value: personId,
            action_ts: '1',
          },
        ],
      });

      return publishedHome(t, workspace, finance, since);
    };

    it('shares the page’s blocks: one person with 6 receipts and nine with 1 show all 15', async () => {
      await people([6, 1, 1, 1, 1, 1, 1, 1, 1, 1]);

      const tab = await open();

      expect(titlesOf(tab)).toHaveLength(15);
      expect(blocksOf(tab)).toBeLessThanOrEqual(100);
      expect(actionIdsOf(tab)).not.toContain(ReceiptsTabActionId.ShowPerson);
    });

    it('offers every person with hidden receipts all of them, and returns to the page', async () => {
      const users = await people(Array(10).fill(5));
      const overview = await open();

      expect(blocksOf(overview)).toBeLessThanOrEqual(100);
      expect(
        actionIdsOf(overview).filter(
          (id) => id === ReceiptsTabActionId.ShowPerson,
        ),
      ).toHaveLength(10);
      expect(
        JSON.stringify(overview.blocks).match(/Show all 5 receipts/g),
      ).toHaveLength(10);

      const person = await showAll(overview, users[3]);

      expect(blocksOf(person)).toBeLessThanOrEqual(100);
      expect(sectionTexts(person)).toEqual([
        '*🧾 Receipts* · Sport · June 2026',
        '*Person 04* · $5.00 of $50.00',
      ]);
      expect(titlesOf(person)).toEqual([
        'p4-1.pdf',
        'p4-2.pdf',
        'p4-3.pdf',
        'p4-4.pdf',
        'p4-5.pdf',
      ]);
      expect(listItems(person).map(({ buttons }) => buttons)).toEqual(
        Array(5).fill([
          ReceiptsTabActionId.AcceptReceipt,
          ReceiptsTabActionId.RejectReceipt,
        ]),
      );
      expect(actionIdsOf(person)).not.toContain(ReceiptsTabActionId.NextMonth);
      expect(actionIdsOf(person)).not.toContain(
        ReceiptsTabActionId.SelectReimbursement,
      );

      const back = await actOnTab(
        t,
        workspace,
        finance,
        person,
        ReceiptsTabActionId.AllPeople,
      );

      expect(sectionTexts(back)).toContain('*Person 04* · $5.00 of $50.00');
      expect(titlesOf(back).length).toBeGreaterThan(10);
    });

    it('returns to the page of people the viewer came from', async () => {
      const users = await people(Array(20).fill(5));
      const second = await actOnTab(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.PaginationNext,
        '2',
      );
      const person = await showAll(second, users[14]);

      expect(sectionTexts(person)).toContain('*Person 15* · $5.00 of $50.00');

      const back = await actOnTab(
        t,
        workspace,
        finance,
        person,
        ReceiptsTabActionId.AllPeople,
      );

      expect(listCount(back)).toBe('11–20 of 20');
    });

    it('decides on the hidden 5th receipt, and reverses a rejection there', async () => {
      const [person] = await people(Array(10).fill(5));
      const fifth = (await workspace.rows('receipts')).find(
        ({ file_name }) => file_name === 'p1-5.pdf',
      )!;

      const view = await showAll(await open(), person);
      const rejecting = await openModalFrom(
        t,
        workspace,
        finance,
        view,
        ReceiptsTabActionId.RejectReceipt,
        fifth.id,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, finance, rejecting, { reason: 'Unreadable' })
        .expect(200);

      const shown = await publishedHome(t, workspace, finance, since);

      expect(noticeOf(shown)).toBe(
        '❌ Rejected p1-5.pdf. Person 01 gets a message about it.',
      );
      // Still the person's view.
      expect(titlesOf(shown)).toHaveLength(5);
      expect((await receiptRow(fifth.id)).status).toBe(ReceiptStatus.Rejected);
      expect(
        t.slackApi.postedMessages(workspace.token, person.slack_id),
      ).toHaveLength(1);

      const reversed = await actOnTab(
        t,
        workspace,
        finance,
        shown,
        ReceiptsTabActionId.ManageReceiptMenu,
        `${ReceiptsTabActionId.AcceptReceipt}:${fifth.id}`,
      );

      expect(noticeOf(reversed)).toBe('✅ Accepted p1-5.pdf from Person 01.');
      expect((await receiptRow(fifth.id)).status).toBe(ReceiptStatus.Accepted);
      expect(titlesOf(reversed)).toHaveLength(5);
    });

    it('pages through a person’s 45 receipts, each page within 100 blocks', async () => {
      const [person] = await people([45]);
      let view = await showAll(await open(), person);
      const titles: string[] = [];
      const counts: number[] = [];

      for (let page = 1; page <= 3; page++) {
        counts.push(blocksOf(view));
        titles.push(...titlesOf(view));

        if (page < 3) {
          view = await actOnTab(
            t,
            workspace,
            finance,
            view,
            ReceiptsTabActionId.PaginationNext,
            String(page + 1),
          );
        }
      }

      expect(counts.every((count) => count <= 100)).toBe(true);
      expect(titles).toHaveLength(45);
      expect(new Set(titles).size).toBe(45);
      expect(listCount(view)).toBe('41–45 of 45');
    });

    it('shows the overview for a person with no receipt that month, or from another workspace', async () => {
      await people([5]);
      const other = await t.createWorkspace();
      const stranger = await other.addUser({ name: 'Stranger' });
      const overview = await open();

      for (const id of [anna.id, stranger.id]) {
        const shown = await forgeShowPerson(overview, id);

        expect(sectionTexts(shown)).toContain(
          '1 of 4 people sent receipts · 5 waiting · due 5 Jul',
        );
        expect(actionIdsOf(shown)).toContain(ReceiptsTabActionId.NextMonth);
      }
    });
  });

  describe('deciding', () => {
    const decide = async (
      receipt: Tables<'receipts'>,
      view: View,
      actionId: ReceiptsTabActionId,
      value = receipt.id,
    ) => actOnTab(t, workspace, finance, view, actionId, value);

    it('accepts a receipt and says so', async () => {
      const receipt = await seed(anna, {
        fileName: 'gym-june.pdf',
        amountCents: 3000,
      });

      const shown = await decide(
        receipt,
        await open(),
        ReceiptsTabActionId.AcceptReceipt,
      );

      expect(noticeOf(shown)).toBe('✅ Accepted gym-june.pdf from Anna Kim.');
      expect(await receiptRow(receipt.id)).toEqual(
        expect.objectContaining({
          status: ReceiptStatus.Accepted,
          decided_by: finance.id,
        }),
      );
      expect(listItems(shown)[0].buttons).toEqual([]);
      // Accepting sends nothing.
      expect(t.slackApi.postedMessages(workspace.token, anna.slack_id)).toEqual(
        [],
      );
    });

    it('accepts a rejected receipt from the menu of a decided one', async () => {
      const receipt = await seed(anna, {
        fileName: 'gym-june.pdf',
        amountCents: 3000,
        status: ReceiptStatus.Rejected,
      });
      await t.db
        .updateTable('receipts')
        .set({ rejection_reason: 'Blurry' })
        .where('id', '=', receipt.id)
        .execute();

      const tab = await open();

      expect(listItems(tab)[0]).toEqual(
        expect.objectContaining({
          fields: {
            Amount: '$30.00',
            Status: '❌ Rejected',
            Reason: 'Blurry',
          },
          menu: [ReceiptsTabActionId.AcceptReceipt],
        }),
      );

      const shown = await decide(
        receipt,
        tab,
        ReceiptsTabActionId.ManageReceiptMenu,
        `${ReceiptsTabActionId.AcceptReceipt}:${receipt.id}`,
      );

      expect(noticeOf(shown)).toBe('✅ Accepted gym-june.pdf from Anna Kim.');
      expect((await receiptRow(receipt.id)).status).toBe(
        ReceiptStatus.Accepted,
      );
    });

    it('shows a refusal as a notice: the receipt changed meanwhile', async () => {
      const receipt = await seed(anna, {
        fileName: 'gym-june.pdf',
        amountCents: 3000,
      });
      const stale = await open();

      await t.db
        .updateTable('receipts')
        .set({ status: ReceiptStatus.Accepted })
        .where('id', '=', receipt.id)
        .execute();

      const shown = await decide(
        receipt,
        stale,
        ReceiptsTabActionId.AcceptReceipt,
      );

      expect(noticeOf(shown)).toBe('⚠️ This receipt was changed meanwhile.');
    });

    it('rejects with a reason, and tells the owner in a DM', async () => {
      const receipt = await seed(anna, {
        fileName: 'gym-june.pdf',
        amountCents: 3000,
      });
      const form = await openModalFrom(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.RejectReceipt,
        receipt.id,
      );

      const empty = await t.slack
        .submitView(workspace, finance, form, { reason: '' })
        .expect(200);

      expect(empty.body).toEqual({
        response_action: 'errors',
        errors: { reason_block: 'Give a reason.' },
      });
      expect((await receiptRow(receipt.id)).status).toBe(
        ReceiptStatus.Submitted,
      );

      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, finance, form, { reason: '<@U1> is blurry' })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      expect(await receiptRow(receipt.id)).toEqual(
        expect.objectContaining({
          status: ReceiptStatus.Rejected,
          rejection_reason: '<@U1> is blurry',
          decided_by: finance.id,
        }),
      );
      expect(noticeOf(await publishedHome(t, workspace, finance, since))).toBe(
        '❌ Rejected gym-june.pdf. Anna Kim gets a message about it.',
      );
      const [message] = t.slackApi.postedMessages(
        workspace.token,
        anna.slack_id,
      );

      expect(message.text).toBe(
        '❌ Your receipt *gym-june.pdf* for Sport, June 2026 was rejected: &lt;@U1&gt; is blurry\nFix the details, or send a new photo or PDF here if the file was the problem.',
      );
      expect(actionIdsOf(message)).toEqual([ReceiptActionId.EditDetails]);
    });

    it('lets the owner fix the details from the DM', async () => {
      const receipt = await seed(anna, {
        fileName: 'gym-june.pdf',
        amountCents: 3000,
      });
      const form = await openModalFrom(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.RejectReceipt,
        receipt.id,
      );

      await t.slack
        .submitView(workspace, finance, form, { reason: 'Wrong amount' })
        .expect(200);
      await t.idle();
      const [message] = t.slackApi.postedMessages(
        workspace.token,
        anna.slack_id,
      );
      const since = t.slackApi.mark();

      await t.slack
        .actOnMessage(
          workspace,
          anna,
          message,
          ReceiptActionId.EditDetails,
          receipt.id,
        )
        .expect(200);
      await t.idle();

      await t.slack
        .submitView(
          workspace,
          anna,
          t.slackApi.openedModal(workspace.token, { since }),
          {
            amount: '31.00',
          },
        )
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );
      await t.idle();

      expect(await receiptRow(receipt.id)).toEqual(
        expect.objectContaining({
          status: ReceiptStatus.Submitted,
          amount_cents: 3100,
        }),
      );
      expect(
        t.slackApi.messageUpdates(workspace.token, message).pop()?.text,
      ).toBe(
        '🧾 *gym-june.pdf* · Sport · June 2026 · $31.00 — sent to Finance.',
      );
    });
  });

  describe('Reimbursements', () => {
    const openList = async () =>
      actOnTab(
        t,
        workspace,
        finance,
        await open(),
        ReceiptsTabActionId.OpenReimbursements,
      );

    it('lists the active ones, and Back leads to the receipts', async () => {
      const archived = await seedReimbursement(t, workspace, { name: 'Old' });

      await t.db
        .updateTable('reimbursements')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', archived.id)
        .execute();

      const list = await openList();

      expect(
        listItems(list).map(({ title, fields }) => [title, fields]),
      ).toEqual([
        [
          'Sport',
          {
            Due: 'day 5 of the next month',
            Limit: '$50.00 per person and month',
          },
        ],
      ]);
      expect(actionIdsOf(list)).toContain(NavigationActionId.Receipts);
      expect(actionIdsOf(list)).toContain(ReceiptsTabActionId.AddReimbursement);
    });

    it('adds one, and refuses a name already taken at its field', async () => {
      const form = await openModalFrom(
        t,
        workspace,
        finance,
        await openList(),
        ReceiptsTabActionId.AddReimbursement,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, finance, form, {
          name: 'Lunch',
          dueDay: '10',
          limit: '25.50',
        })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      const shown = await publishedHome(t, workspace, finance, since);

      expect(noticeOf(shown)).toBe('✅ Reimbursement Lunch added.');
      expect(titlesOf(shown)).toEqual(['Lunch', 'Sport']);
      expect(
        (await workspace.rows('reimbursements')).find(
          ({ name }) => name === 'Lunch',
        ),
      ).toEqual(expect.objectContaining({ due_day: 10, limit_cents: 2550 }));

      const duplicate = await t.slack
        .submitView(workspace, finance, form, {
          name: 'sport',
          dueDay: '10',
          limit: '',
        })
        .expect(200);

      expect(duplicate.body).toEqual({
        response_action: 'errors',
        errors: {
          name_block: 'A reimbursement with this name already exists.',
        },
      });
    });

    it('refuses a due day and a limit it can’t use at their fields', async () => {
      const form = await openModalFrom(
        t,
        workspace,
        finance,
        await openList(),
        ReceiptsTabActionId.AddReimbursement,
      );
      const response = await t.slack
        .submitView(workspace, finance, form, {
          name: 'Lunch',
          dueDay: '31',
          limit: 'a lot',
        })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: {
          due_day_block: 'The due day is from 1 to 28.',
          limit_block: 'Enter an amount above zero, like 50.00.',
        },
      });
    });

    it('renames one and takes its limit away', async () => {
      const list = await openList();
      const form = await openModalFrom(
        t,
        workspace,
        finance,
        list,
        ReceiptsTabActionId.ManageReimbursementMenu,
        `${ReceiptsTabActionId.EditReimbursement}:${sport.id}`,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, finance, form, {
          name: 'Fitness',
          dueDay: '7',
          limit: '',
        })
        .expect(200);

      expect(noticeOf(await publishedHome(t, workspace, finance, since))).toBe(
        '✅ Reimbursement Fitness updated.',
      );
      expect(await workspace.row('reimbursements', sport.id)).toEqual(
        expect.objectContaining({
          name: 'Fitness',
          due_day: 7,
          limit_cents: null,
        }),
      );
    });

    it('archives one after a confirmation', async () => {
      const confirmation = await openModalFrom(
        t,
        workspace,
        finance,
        await openList(),
        ReceiptsTabActionId.ManageReimbursementMenu,
        `${ReceiptsTabActionId.ArchiveReimbursement}:${sport.id}`,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, finance, confirmation)
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );

      const shown = await publishedHome(t, workspace, finance, since);

      expect(noticeOf(shown)).toBe('✅ Reimbursement Sport archived.');
      expect(titlesOf(shown)).toEqual([]);
      expect(
        (await workspace.row('reimbursements', sport.id)).archived_at,
      ).not.toBeNull();
    });
  });
});
