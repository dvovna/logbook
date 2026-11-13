import { Injectable } from '@nestjs/common';
import { KnownBlock } from '@slack/types';
import pluralize from 'pluralize';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import {
  clip,
  section,
} from '@modules/slack/common/views/components/message-sections';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { IReceiptMessage } from '@modules/slack/receipts/views/received-receipt-message.view';
import { dayMonthLabel, monthLabel } from 'src/receipts/utils/receipt-months';

const MAX_NAME_CHARACTERS = 100;

// The reimbursement's name is an admin's text.
const nameOf = (name: string) => escapeMrkdwn(clip(name, MAX_NAME_CHARACTERS));

const button = (
  actionId: ReceiptActionId,
  text: string,
  value: string,
  style?: 'primary',
): KnownBlock => ({
  type: 'actions',
  block_id: ViewCallbackId.ReceiptReminderMessage,
  elements: [
    {
      type: 'button',
      action_id: actionId,
      value,
      text: { type: 'plain_text', text },
      ...(style ? { style } : {}),
    },
  ],
});

const message = (text: string, extra: KnownBlock[] = []): IReceiptMessage => ({
  text,
  blocks: [section(text), ...extra],
});

interface IReminderFacts {
  reimbursementId: string;
  name: string;
  month: string;
  dueDate: string;
}

// The value of Open receipts: the screen needs the month as well.
export const openValueOf = (reimbursementId: string, month: string) =>
  `${reimbursementId}:${month}`;

export const parseOpenValue = (value: string) => {
  const [reimbursementId, month] = value.split(':');

  return { reimbursementId: reimbursementId ?? '', month: month ?? '' };
};

@Injectable()
export class ReceiptReminderMessageView {
  public opened(facts: IReminderFacts): IReceiptMessage {
    return message(
      `🧾 Receipts for *${nameOf(facts.name)}* for ${monthLabel(facts.month)} are due by ${dayMonthLabel(facts.dueDate)}. Send a photo or PDF here.`,
      [this.optOutButton(facts)],
    );
  }

  // `sentNothing` is false for someone who sent receipts and still has drafts.
  public due(
    facts: IReminderFacts,
    { sentNothing, drafts }: { sentNothing: boolean; drafts: number },
  ): IReceiptMessage {
    const dueLine = `Receipts for *${nameOf(facts.name)}* for ${monthLabel(facts.month)} are due tomorrow, ${dayMonthLabel(facts.dueDate)}.`;
    const draftLine = `You have ${pluralize('receipt', drafts, true)} that still ${drafts === 1 ? 'needs' : 'need'} details.`;
    const text = sentNothing
      ? [`🧾 ${dueLine}`, ...(drafts ? [draftLine] : [])].join('\n')
      : `🧾 ${draftLine} ${dueLine}`;

    return message(text, [this.optOutButton(facts)]);
  }

  public optedOut(name: string): IReceiptMessage {
    return message(
      `🔕 You won't be reminded about ${nameOf(name)}. Turn it back on in Home → 🔔 Reminders.`,
    );
  }

  public summary(
    facts: IReminderFacts & { sent: number; of: number; waiting: number },
  ): IReceiptMessage {
    return message(this.summaryText(facts), [
      button(
        ReceiptActionId.OpenReceipts,
        'Open receipts',
        openValueOf(facts.reimbursementId, facts.month),
        'primary',
      ),
    ]);
  }

  // What the summary says once its button was used.
  public summaryOpened(text: string): IReceiptMessage {
    return message(`${text}\nOpen Logbook's Home to see them.`);
  }

  private summaryText(
    facts: IReminderFacts & { sent: number; of: number; waiting: number },
  ): string {
    return `🧾 *${nameOf(facts.name)}*, ${monthLabel(facts.month)}: ${facts.sent} of ${facts.of} people sent receipts, ${facts.waiting} waiting for you.`;
  }

  private optOutButton(facts: IReminderFacts): KnownBlock {
    return button(
      ReceiptActionId.NoReminders,
      "I don't use this",
      facts.reimbursementId,
    );
  }
}
