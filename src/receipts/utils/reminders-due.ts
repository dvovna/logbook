import {
  addMonths,
  dueDateOf,
  monthOf,
} from '@modules/receipts/utils/receipt-months';

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

const DAY_MS = 24 * 60 * 60 * 1000;

const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

// The reminders of one reimbursement that are due at `now`, each for the
// month it collects. Only on the day itself and from 09:00 UTC: a day the app
// was down is skipped, and the claim of each (reimbursement, month, kind)
// keeps the day's ticks to one. Nothing for a month before the one the
// reimbursement was created in.
//
// Each day is worked out from the calendar, not from the day of the month: a
// due date of 28 February has its summary on 1 March, when the month opening
// is February's. So two months are looked at, the one before today's and the
// one before that; when two reminders fall on one day the newer month's comes
// first.
export const remindersDue = (
  now: Date,
  reimbursement: { dueDay: number; createdAt: string },
): { kind: ReimbursementReminderKind; month: string }[] => {
  if (now.getUTCHours() < REMIND_FROM_HOUR_UTC) {
    return [];
  }

  const today = now.toISOString().slice(0, 10);
  const created = monthOf(reimbursement.createdAt);
  const result: { kind: ReimbursementReminderKind; month: string }[] = [];

  for (const month of [-1, -2].map((back) => addMonths(monthOf(today), back))) {
    if (month < created) {
      continue;
    }

    const dueDate = dueDateOf(month, reimbursement.dueDay);

    if (addMonths(month, 1) === today) {
      result.push({ kind: ReimbursementReminderKind.Opened, month });
    }

    if (
      reimbursement.dueDay >= MIN_DUE_DAY_FOR_DUE_REMINDER &&
      shiftDay(dueDate, -1) === today
    ) {
      result.push({ kind: ReimbursementReminderKind.Due, month });
    }

    if (shiftDay(dueDate, 1) === today) {
      result.push({ kind: ReimbursementReminderKind.Summary, month });
    }
  }

  return result;
};
