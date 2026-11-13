import { addMonths, monthOf } from '@modules/receipts/utils/receipt-months';

export enum ReimbursementReminderKind {
  Opened = 'opened',
  Due = 'due',
  Summary = 'summary',
}

// Reminders go out from this hour (UTC) on the day itself.
const REMIND_FROM_HOUR_UTC = 9;
// The day before a due date on the 1st or 2nd would fall in the month being
// collected; those get no reminder of the day before.
const MIN_DUE_DAY_FOR_DUE_REMINDER = 3;

// The reminders of one reimbursement that are due at `now`, each for the
// month it collects. Only on the day itself and from 09:00 UTC: a day the app
// was down is skipped, and the claim of each (reimbursement, month, kind)
// keeps the day's ticks to one. Nothing for a month before the one the
// reimbursement was created in.
export const remindersDue = (
  now: Date,
  reimbursement: { dueDay: number; createdAt: string },
): { kind: ReimbursementReminderKind; month: string }[] => {
  if (now.getUTCHours() < REMIND_FROM_HOUR_UTC) {
    return [];
  }

  const today = now.toISOString().slice(0, 10);
  const day = Number(today.slice(8, 10));
  // The month being collected: always the one before today's, since the due
  // day, the day before it and the day after it all fall in the next month.
  const month = addMonths(monthOf(today), -1);

  if (month < monthOf(reimbursement.createdAt)) {
    return [];
  }

  const kinds: ReimbursementReminderKind[] = [];

  if (day === 1) {
    kinds.push(ReimbursementReminderKind.Opened);
  }

  if (
    reimbursement.dueDay >= MIN_DUE_DAY_FOR_DUE_REMINDER &&
    day === reimbursement.dueDay - 1
  ) {
    kinds.push(ReimbursementReminderKind.Due);
  }

  if (day === reimbursement.dueDay + 1) {
    kinds.push(ReimbursementReminderKind.Summary);
  }

  return kinds.map((kind) => ({ kind, month }));
};
