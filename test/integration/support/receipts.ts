import { createHash, randomBytes, randomUUID } from 'crypto';
import { View } from '@slack/types/dist/views';
import { Tables } from '@common/types/database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ITestApp } from './test-app';
import { TestWorkspace } from './test-workspace';
import { shareTeamFile } from './team-file';

export const seedReimbursement = (
  t: ITestApp,
  workspace: TestWorkspace,
  fields: { name?: string; dueDay?: number; limitCents?: number | null } = {},
): Promise<Tables<'reimbursements'>> =>
  t.db
    .insertInto('reimbursements')
    .values({
      slack_team_id: workspace.id,
      name: fields.name ?? `Gym ${randomUUID().slice(0, 8)}`,
      due_day: fields.dueDay ?? 5,
      limit_cents: fields.limitCents ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

export const seedReceipt = async (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  fields: {
    reimbursement: Tables<'reimbursements'>;
    month: string;
    amountCents: number;
    status?: ReceiptStatus;
    content?: Buffer;
  },
): Promise<Tables<'receipts'>> => {
  const content = fields.content ?? randomBytes(32);
  const status = fields.status ?? ReceiptStatus.Submitted;

  const receipt = await t.db
    .insertInto('receipts')
    .values({
      slack_team_id: workspace.id,
      user_id: user.id,
      reimbursement_id: fields.reimbursement.id,
      month: fields.month,
      amount_cents: fields.amountCents,
      status,
      submitted_at: new Date().toISOString(),
      file_name: 'receipt.pdf',
      mime_type: 'application/pdf',
      size_bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      slack_file_id: `F${randomUUID().replace(/-/g, '').slice(0, 10)}`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await t.db
    .insertInto('receipt_files')
    .values({
      receipt_id: receipt.id,
      slack_team_id: workspace.id,
      content: content as never,
    })
    .execute();

  return receipt;
};

// Shares the file in the DM with the app, as a photo or a PDF, and returns
// what the app posted back to the sender.
export const shareReceipt = (
  t: ITestApp,
  workspace: TestWorkspace,
  user: Tables<'users'>,
  content: string | Buffer,
  fileName = 'receipt.pdf',
) => shareTeamFile(t, workspace, user, content, fileName);

type SlackElement = {
  type?: string;
  action_id?: string;
  value?: string;
  options?: { value: string }[];
};

const elementsOf = (view: View): SlackElement[] =>
  (
    view.blocks as { elements?: SlackElement[]; accessory?: SlackElement }[]
  ).flatMap((block) => [
    ...(block.elements ?? []),
    ...(block.accessory ? [block.accessory] : []),
  ]);

// What Finance's screen put in a receipt's Accept or Reject button: the
// receipt and the moment it was sent, as it was shown.
export const buttonValueOf = (
  view: View,
  actionId: string,
  receiptId: string,
): string => {
  const button = elementsOf(view).find(
    (element) =>
      element.action_id === actionId && element.value?.startsWith(receiptId),
  );

  if (!button?.value) {
    throw new Error(`No ${actionId} button for receipt ${receiptId}`);
  }

  return button.value;
};

// The same in the ⋯ menu of a decided receipt: `<action>:<value>`.
export const menuValueOf = (
  view: View,
  action: string,
  receiptId: string,
): string => {
  const value = elementsOf(view)
    .flatMap(({ options }) => options ?? [])
    .map((option) => option.value)
    .find((option) => option.startsWith(`${action}:${receiptId}`));

  if (!value) {
    throw new Error(`No ${action} option for receipt ${receiptId}`);
  }

  return value;
};
