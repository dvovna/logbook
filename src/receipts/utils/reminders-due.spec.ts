import {
  ReimbursementReminderKind,
  remindersDue,
} from '@modules/receipts/utils/reminders-due';

describe('remindersDue', () => {
  const r = { dueDay: 4, createdAt: '2026-10-20T10:00:00.000000+00:00' };
  const at = (iso: string) => remindersDue(new Date(iso), r);

  it('opens the month on the 1st, from 09:00', () => {
    expect(at('2026-11-01T09:05:00Z')).toEqual([
      { kind: ReimbursementReminderKind.Opened, month: '2026-10-01' },
    ]);
    expect(at('2026-11-01T08:59:00Z')).toEqual([]);
  });

  it('reminds the day before the due date', () => {
    expect(at('2026-11-03T12:00:00Z')).toEqual([
      { kind: ReimbursementReminderKind.Due, month: '2026-10-01' },
    ]);
  });

  it('summarizes the day after the due date', () => {
    expect(at('2026-11-05T09:00:00Z')).toEqual([
      { kind: ReimbursementReminderKind.Summary, month: '2026-10-01' },
    ]);
  });

  it('has nothing on the other days', () => {
    expect(at('2026-11-02T12:00:00Z')).toEqual([]);
    expect(at('2026-11-04T12:00:00Z')).toEqual([]);
  });

  it('has nothing for a month before the reimbursement existed', () => {
    expect(
      remindersDue(new Date('2026-11-01T09:05:00Z'), {
        dueDay: 4,
        createdAt: '2026-11-01T08:00:00.000000+00:00',
      }),
    ).toEqual([]);
  });

  it('has no due reminder when the due day is the 1st or 2nd', () => {
    expect(
      remindersDue(new Date('2026-10-31T12:00:00Z'), { ...r, dueDay: 1 }),
    ).toEqual([]);
    expect(
      remindersDue(new Date('2026-11-01T12:00:00Z'), { ...r, dueDay: 2 }),
    ).toEqual([
      { kind: ReimbursementReminderKind.Opened, month: '2026-10-01' },
    ]);
    expect(
      remindersDue(new Date('2026-11-02T09:00:00Z'), { ...r, dueDay: 1 }),
    ).toEqual([
      { kind: ReimbursementReminderKind.Summary, month: '2026-10-01' },
    ]);
  });

  it('crosses the year', () => {
    expect(remindersDue(new Date('2027-01-01T09:00:00Z'), r)).toEqual([
      { kind: ReimbursementReminderKind.Opened, month: '2026-12-01' },
    ]);
  });
});
