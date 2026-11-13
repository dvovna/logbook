import { getDateOnly } from '@common/utils/date.utils';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';

// Reminders go out from this hour, UTC.
export const REMIND_FROM_HOUR_UTC = 9;

// The day whose daily reminder may go out now: a working day (in UTC, as
// the rest of the reminders), from REMIND_FROM_HOUR_UTC on.
export const dailyReminderDay = (now: Date): string | null => {
  const weekday = now.getUTCDay();

  return weekday === 0 ||
    weekday === 6 ||
    now.getUTCHours() < REMIND_FROM_HOUR_UTC
    ? null
    : getDateOnly(now);
};

// Who the reminder of the week starting `monday` goes to: the people
// reminded every week, and in the week of a month's first Monday the ones
// reminded once a month.
export const weeklyReminderGroups = (monday: string): TimeReminder[] =>
  Number(monday.slice(8)) <= 7
    ? [TimeReminder.Weekly, TimeReminder.Monthly]
    : [TimeReminder.Weekly];
