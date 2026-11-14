import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import {
  dailyReminderDay,
  dueReminders,
  weeklyReminderGroups,
} from 'src/time-entries/utils/time-reminder-schedule';

describe('dailyReminderDay', () => {
  it('is the day itself on a working day from 09:00 UTC', () => {
    expect(dailyReminderDay(new Date('2026-06-15T09:00:00Z'))).toBe(
      '2026-06-15',
    );
    expect(dailyReminderDay(new Date('2026-06-19T23:59:00Z'))).toBe(
      '2026-06-19',
    );
  });

  it('is none before 09:00 UTC', () => {
    expect(dailyReminderDay(new Date('2026-06-15T08:59:00Z'))).toBeNull();
  });

  it('is none at the weekend', () => {
    expect(dailyReminderDay(new Date('2026-06-20T12:00:00Z'))).toBeNull();
    expect(dailyReminderDay(new Date('2026-06-21T12:00:00Z'))).toBeNull();
  });
});

describe('weeklyReminderGroups', () => {
  it('adds the monthly ones in the week of the first Monday', () => {
    expect(weeklyReminderGroups('2026-06-01')).toEqual([
      TimeReminder.Weekly,
      TimeReminder.Monthly,
    ]);
    expect(weeklyReminderGroups('2026-09-07')).toEqual([
      TimeReminder.Weekly,
      TimeReminder.Monthly,
    ]);
  });

  it('is the weekly ones alone in the other weeks', () => {
    expect(weeklyReminderGroups('2026-06-08')).toEqual([TimeReminder.Weekly]);
    expect(weeklyReminderGroups('2026-06-29')).toEqual([TimeReminder.Weekly]);
  });
});

describe('dueReminders', () => {
  it('is nothing on Monday before 09:00 UTC', () => {
    expect(dueReminders(new Date('2026-06-15T08:59:00Z'))).toBeNull();
  });

  it("is the week's and the day's from Monday 09:00 UTC", () => {
    expect(dueReminders(new Date('2026-06-15T09:00:00Z'))).toEqual({
      monday: '2026-06-15',
      day: '2026-06-15',
    });
  });

  it("is the week's alone at the weekend, for a Monday the app missed", () => {
    expect(dueReminders(new Date('2026-06-20T12:00:00Z'))).toEqual({
      monday: '2026-06-15',
      day: null,
    });
  });
});
