import UserRole from '@common/enums/user-role.enum';
import { formatDate } from '@common/utils/date.utils';
import { Tables } from '@common/types/database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { IPostedMessage } from './support/fake-slack-api.client';
import { dmOf, messageTexts } from './support/team-file';
import { seedReimbursement, shareReceipt } from './support/receipts';
import { actionIdsOf } from './support/tab-readers';
import { SlackJson } from './support/block-kit';

const WAITING = (file: string) =>
  `🧾 Got your receipt *${file}*. Add the details so Finance can check it.`;

describe('Sending a receipt in the DM', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    member = await workspace.addUser({ name: 'Mia Member' });
  });

  const receipts = () => workspace.rows('receipts');

  const ephemeralTo = (user: Tables<'users'>) =>
    t.slackApi
      .ephemeralMessages(workspace.token, user.slack_id)
      .map(({ text }) => text);

  const addDetails = async (message: IPostedMessage, user = member) => {
    const since = t.slackApi.mark();

    await t.slack
      .actOnMessage(
        workspace,
        user,
        message,
        ReceiptActionId.AddDetails,
        (await receipts())[0]?.id,
      )
      .expect(200);
    await t.idle();

    return t.slackApi.shownModal(workspace.token, { since });
  };

  describe('a file in the DM', () => {
    it('becomes a draft and a message with Add details and Discard', async () => {
      await seedReimbursement(t, workspace);

      const posted = await shareReceipt(t, workspace, member, 'pdf', 'gym.pdf');

      expect((await receipts()).map(({ status }) => status)).toEqual([
        ReceiptStatus.Draft,
      ]);
      expect(posted).toHaveLength(1);
      expect(messageTexts(posted[0])).toEqual([WAITING('gym.pdf')]);
      expect(actionIdsOf(posted[0])).toEqual([
        ReceiptActionId.AddDetails,
        ReceiptActionId.Discard,
      ]);
    });

    it('takes any case and format of the name: two files, two drafts', async () => {
      await seedReimbursement(t, workspace);

      await shareReceipt(t, workspace, member, 'jpeg', 'photo.JPG');
      await shareReceipt(t, workspace, member, 'heic', 'scan.heic');

      expect(
        (await receipts()).map(({ file_name }) => file_name).sort(),
      ).toEqual(['photo.JPG', 'scan.heic']);
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id),
      ).toHaveLength(2);
    });

    it('is one receipt when Slack delivers the event again, and the same bytes sent again are told so', async () => {
      await seedReimbursement(t, workspace);
      const event = {
        type: 'event_callback',
        team_id: workspace.slackId,
        api_app_id: 'A_TEST',
        event_id: 'EvRECEIPT1',
        event_time: Math.floor(Date.now() / 1000),
        event: {
          type: 'file_shared',
          file_id: t.slackApi.addFile('gym.pdf', 'same bytes'),
          user_id: member.slack_id,
          channel_id: dmOf(member),
        },
      };

      await t.slack.rawEvent(event).expect(acknowledged);
      await t.slack
        .rawEvent(event, { 'X-Slack-Retry-Num': '1' })
        .expect(acknowledged);
      await t.idle();

      expect(await receipts()).toHaveLength(1);
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id),
      ).toHaveLength(1);

      await shareReceipt(t, workspace, member, 'same bytes', 'again.pdf');

      expect(await receipts()).toHaveLength(1);
      // created_at is the database's own clock, not the test's.
      expect(ephemeralTo(member)).toEqual([
        `You already sent this file on ${formatDate((await receipts())[0].created_at)} (📝 Needs details).`,
      ]);
    });

    it('posts the message again when a second run finds the receipt still a draft', async () => {
      await seedReimbursement(t, workspace);
      const fileId = t.slackApi.addFile('gym.pdf', 'bytes');
      const share = async () => {
        await t.slack
          .event(workspace, {
            type: 'file_shared',
            file_id: fileId,
            user_id: member.slack_id,
            channel_id: dmOf(member),
          })
          .expect(acknowledged);
        await t.idle();
      };

      await share();
      await share();

      expect(await receipts()).toHaveLength(1);
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id),
      ).toHaveLength(2);
    });

    it('leaves a file in a channel alone', async () => {
      await seedReimbursement(t, workspace);
      const since = t.slackApi.mark();

      await t.slack
        .event(workspace, {
          type: 'file_shared',
          file_id: t.slackApi.addFile('gym.pdf', 'bytes'),
          user_id: member.slack_id,
          channel_id: 'C_GENERAL',
        })
        .expect(acknowledged);
      await t.idle();

      expect(t.slackApi.calls.slice(since)).toEqual([]);
      expect(await receipts()).toEqual([]);
    });

    it('says so when there is no reimbursement, and an admin where to add one', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });

      await shareReceipt(t, workspace, member, 'bytes', 'gym.pdf');
      await shareReceipt(t, workspace, admin, 'bytes', 'gym.pdf');

      expect(ephemeralTo(member)).toEqual([
        'There are no reimbursements to send receipts for yet.',
      ]);
      expect(ephemeralTo(admin)).toEqual([
        'There are no reimbursements to send receipts for yet. Add one in More → Receipts → Reimbursements.',
      ]);
      expect(await receipts()).toEqual([]);
    });

    it('refuses a file over 10 MB without downloading it', async () => {
      await seedReimbursement(t, workspace);
      const since = t.slackApi.mark();

      await t.slack
        .event(workspace, {
          type: 'file_shared',
          file_id: t.slackApi.addFile('big.pdf', 'x', {
            size: 11 * 1024 * 1024,
          }),
          user_id: member.slack_id,
          channel_id: dmOf(member),
        })
        .expect(acknowledged);
      await t.idle();

      expect(ephemeralTo(member)).toEqual([
        '❗️ The file is larger than 10 MB. Send a smaller photo or PDF.',
      ]);
      expect(
        t.slackApi.callsWith(workspace.token, 'files.download', { since }),
      ).toEqual([]);
      expect(await receipts()).toEqual([]);
    });
  });

  describe('spreadsheets keep their routing', () => {
    it('refuses a Member who shares a team file', async () => {
      await shareReceipt(
        t,
        workspace,
        member,
        'Email,Team\n',
        'team-setup.csv',
      );

      expect(ephemeralTo(member)).toEqual([
        '⛔ Only Admin or HR can import files into Logbook.',
      ]);
      expect(await receipts()).toEqual([]);
    });

    it('gives HR the team file preview', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      const posted = await shareReceipt(
        t,
        workspace,
        hr,
        `Name,Email,Team,Team lead\nAnna,${anna.email},Acme,`,
        'team-setup.csv',
      );

      expect(posted).toHaveLength(1);
      expect(await receipts()).toEqual([]);
    });
  });

  describe('the details', () => {
    const blockOf = (view: SlackJson, blockId: string) =>
      (view.blocks as SlackJson[]).find((block) => block.block_id === blockId);

    it('are asked with the reimbursement and the collected month preset, and sent to Finance', async () => {
      const gym = await seedReimbursement(t, workspace, { name: 'Gym' });
      const [message] = await shareReceipt(
        t,
        workspace,
        member,
        'b',
        'gym.pdf',
      );

      const form = await addDetails(message);

      expect(
        blockOf(form, 'reimbursement_block')?.element.initial_option,
      ).toEqual({ text: { type: 'plain_text', text: 'Gym' }, value: gym.id });
      expect(blockOf(form, 'month_block')?.element.initial_option).toEqual({
        text: { type: 'plain_text', text: 'June 2026' },
        value: '2026-06-01',
      });

      await t.slack
        .submitView(workspace, member, form, { amount: '45,50' })
        .expect(200)
        .expect(({ body }) =>
          expect(body).toEqual({ response_action: 'clear' }),
        );
      await t.idle();

      expect(await receipts()).toEqual([
        expect.objectContaining({
          status: ReceiptStatus.Submitted,
          amount_cents: 4550,
          reimbursement_id: gym.id,
          month: '2026-06-01',
        }),
      ]);
      expect(
        messageTexts(t.slackApi.messageUpdates(workspace.token, message).pop()),
      ).toEqual(['🧾 *gym.pdf* · Gym · June 2026 · $45.50 — sent to Finance.']);
    });

    it('leave the reimbursement to the person when there are several', async () => {
      await seedReimbursement(t, workspace);
      await seedReimbursement(t, workspace);
      const [message] = await shareReceipt(
        t,
        workspace,
        member,
        'b',
        'gym.pdf',
      );

      const form = await addDetails(message);

      expect(
        blockOf(form, 'reimbursement_block')?.element.initial_option,
      ).toBeUndefined();
    });

    it('show an amount that is not one at the amount', async () => {
      await seedReimbursement(t, workspace);
      const [message] = await shareReceipt(
        t,
        workspace,
        member,
        'b',
        'gym.pdf',
      );
      const form = await addDetails(message);

      await t.slack
        .submitView(workspace, member, form, { amount: 'abc' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.response_action).toBe('errors');
          expect(Object.keys(body.errors)).toEqual(['amount_block']);
        });
      await t.idle();

      expect((await receipts())[0].status).toBe(ReceiptStatus.Draft);
    });

    it('are refused to someone who does not own the receipt', async () => {
      await seedReimbursement(t, workspace);
      const other = await workspace.addUser({ name: 'Olga Other' });
      const [message] = await shareReceipt(
        t,
        workspace,
        member,
        'b',
        'gym.pdf',
      );
      const before = await receipts();
      const since = t.slackApi.mark();

      await t.slack
        .actOnMessage(
          workspace,
          other,
          message,
          ReceiptActionId.AddDetails,
          before[0].id,
        )
        .expect(200);
      await t.idle();

      expect(() => t.slackApi.openedModal(workspace.token, { since })).toThrow(
        'No modal was opened',
      );
      expect(await receipts()).toEqual(before);
    });
  });

  it('Discard deletes the receipt and replaces the message', async () => {
    await seedReimbursement(t, workspace);
    const [message] = await shareReceipt(t, workspace, member, 'b', 'gym.pdf');

    await t.slack
      .actOnMessage(
        workspace,
        member,
        message,
        ReceiptActionId.Discard,
        (await receipts())[0].id,
      )
      .expect(200);
    await t.idle();

    expect(await receipts()).toEqual([]);
    expect(
      messageTexts(t.slackApi.messageUpdates(workspace.token, message).pop()),
    ).toEqual(['🗑 Discarded *gym.pdf*.']);
  });
});
