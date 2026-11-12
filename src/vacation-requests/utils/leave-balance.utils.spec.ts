import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import {
  countedOn,
  ICountedRequest,
  IFileBalance,
  ILeaveBalanceInput,
  leaveBalanceOf,
  requestWindowOf,
} from '@modules/vacation-requests/utils/leave-balance.utils';

const POLICY = {
  id: 'policy-1',
  name: 'Policy',
  slack_team_id: 'slack-team-1',
  vacation_days: 26,
  working_days: 20,
  carryover_days: 5,
  bonus_days: 3,
} as IVacationPolicyViewModel;

// Monday to Friday from `start` to `end`: no holidays here.
const weekdays = (start: string, end: string) => {
  const dates: string[] = [];

  for (
    const day = new Date(`${start}T00:00:00Z`);
    day <= new Date(`${end}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (![0, 6].includes(day.getUTCDay())) {
      dates.push(day.toISOString().slice(0, 10));
    }
  }

  return dates;
};

const leave = (
  startDate: string,
  endDate: string,
  type = VacationType.AnnualLeave,
): ICountedRequest => ({
  id: `${type}-${startDate}`,
  status: VacationRequestStatus.Approved,
  type,
  startDate,
  endDate,
  workingDates: weekdays(startDate, endDate),
});

// 10 days, 8 working.
const mar2to11 = leave('2026-03-02', '2026-03-11');
// 11 days, 9 working.
const dec21to31 = leave('2026-12-21', '2026-12-31');
const nov10to13 = leave('2026-11-10', '2026-11-13');
const dec28toJan3 = leave('2026-12-28', '2027-01-03');
const apr6bonus = leave('2026-04-06', '2026-04-06', VacationType.BonusDay);

type IOverrides = Partial<
  Omit<ILeaveBalanceInput, 'date' | 'today' | 'createdAt'>
> & {
  date?: string;
  today?: string;
  createdAt?: string;
  extra?: ICountedRequest[];
};

const input = ({
  date = '2026-11-12',
  today = '2026-11-12',
  createdAt = '2026-01-01',
  extra = [],
  ...overrides
}: IOverrides = {}): ILeaveBalanceInput => ({
  contractStartDate: null,
  carryoverDays: null,
  policy: POLICY,
  requests: [mar2to11, ...extra],
  fileBalance: null,
  createdAt,
  date: new Date(date),
  today: new Date(today),
  ...overrides,
});

const balanceOf = (overrides: IOverrides = {}) =>
  leaveBalanceOf(input(overrides));

const file = (partial: Partial<IFileBalance>): IFileBalance => ({
  balanceOn: '2026-11-12',
  daysLeft: null,
  workingDaysLeft: null,
  bonusDaysLeft: null,
  ...partial,
});

const annual = (r: IVacationPeriodUsageData) => ({
  available: r.usage.annual_leave.available,
  working: r.usage.annual_leave.working_days_available,
  correction: r.limits?.correction ?? null,
});

const bonus = (r: IVacationPeriodUsageData) => ({
  available: r.usage.bonus_day.available,
  correction: r.limits!.correction?.bonusDays ?? 0,
});

describe('leaveBalanceOf', () => {
  it('without a file balance, as today', () =>
    expect(annual(balanceOf({}))).toEqual({
      available: 16,
      working: 12,
      correction: null,
    }));

  it('a file balance on Nov 12 is what is left, and the difference is its correction', () =>
    expect(annual(balanceOf({ fileBalance: file({ daysLeft: 12 }) }))).toEqual({
      available: 12,
      working: 12,
      correction: {
        balanceOn: '2026-11-12',
        days: -4,
        workingDays: null,
        bonusDays: null,
      },
    }));

  it('takes leave from the balance date on from it', () =>
    expect(
      annual(
        balanceOf({ fileBalance: file({ daysLeft: 12 }), extra: [dec21to31] }),
      ).available,
    ).toBe(1));

  it('counts a request across the balance date from that date', () =>
    expect(
      annual(
        balanceOf({ fileBalance: file({ daysLeft: 12 }), extra: [nov10to13] }),
      ).available,
    ).toBe(10));

  it('counts a request across the year end only inside the year', () =>
    expect(
      annual(
        balanceOf({
          fileBalance: file({ daysLeft: 12 }),
          extra: [dec28toJan3],
        }),
      ).available,
    ).toBe(8));

  it('a working days balance leaves calendar days to the dates', () =>
    expect(
      annual(balanceOf({ fileBalance: file({ workingDaysLeft: 7 }) })),
    ).toMatchObject({ available: 16, working: 7 }));

  it('a bonus days balance', () =>
    expect(
      bonus(
        balanceOf({
          fileBalance: file({ bonusDaysLeft: 2 }),
          extra: [apr6bonus],
        }),
      ),
    ).toEqual({ available: 2, correction: 0 }));

  it('a unit given as Logbook counts it has a correction of 0, an empty one none', () =>
    expect(
      balanceOf({ fileBalance: file({ daysLeft: 16, bonusDaysLeft: 3 }) })
        .limits!.correction,
    ).toEqual({
      balanceOn: '2026-11-12',
      days: 0,
      workingDays: null,
      bonusDays: 0,
    }));

  it('half a day', () =>
    expect(
      annual(balanceOf({ fileBalance: file({ daysLeft: 12.5 }) })).available,
    ).toBe(12.5));

  it('a negative balance shows 0 and carries nothing', () => {
    expect(
      annual(balanceOf({ fileBalance: file({ daysLeft: -2 }) })).available,
    ).toBe(0);
    expect(
      balanceOf({
        fileBalance: file({ daysLeft: -2 }),
        date: '2027-03-01',
        today: '2027-03-01',
      }).limits!.carryoverDays,
    ).toBe(0);
  });

  it('next year carries over from the file balance, up to the policy', () =>
    expect(
      balanceOf({
        fileBalance: file({ daysLeft: 12 }),
        date: '2027-03-01',
        today: '2027-03-01',
      }).limits,
    ).toMatchObject({ carryoverDays: 5, correction: null }));

  it('a balance whose date a moved contract start puts in the year before carries over', () =>
    // contract start 2020-11-10: the current year starts 2026-11-10, and the
    // balance of Nov 5 falls in the year before
    expect(
      balanceOf({
        contractStartDate: '2020-11-10',
        fileBalance: file({ daysLeft: 12, balanceOn: '2026-11-05' }),
        extra: [],
      }).limits,
    ).toMatchObject({ carryoverDays: 5, correction: null }));

  it('ignores a file balance of a later year than the one asked', () =>
    expect(
      balanceOf({ fileBalance: file({ daysLeft: 12 }), date: '2025-06-01' })
        .limits!.correction,
    ).toBeNull());

  it('has no limits without a policy', () =>
    expect(
      balanceOf({ policy: null, fileBalance: file({ daysLeft: 12 }) }).limits,
    ).toBeNull());

  it("ignores the profile's carryover in the year of the file balance", () =>
    expect(
      annual(
        balanceOf({ carryoverDays: 3, fileBalance: file({ daysLeft: 12 }) }),
      ),
    ).toMatchObject({ available: 12, working: 15 }));

  it('gives a year still to come no carryover and no correction', () =>
    expect(
      balanceOf({ fileBalance: file({ daysLeft: 12 }), date: '2027-03-01' })
        .limits,
    ).toMatchObject({ carryoverDays: 0, correction: null }));

  it('counts sick, unpaid and other leave in the year as used', () =>
    expect(
      balanceOf({
        extra: [
          leave('2026-05-04', '2026-05-05', VacationType.SickLeave),
          leave('2026-06-01', '2026-06-03', VacationType.UnpaidLeave),
          leave('2025-12-31', '2026-01-01', VacationType.Other),
        ],
      }).usage,
    ).toMatchObject({
      sick_leave: { used: 2 },
      unpaid_leave: { used: 3 },
      other: { used: 1 },
    }));
});

describe('requestWindowOf', () => {
  const windowOf = (overrides: IOverrides) => {
    const { from, to } = requestWindowOf(input(overrides));

    return { from: from.toISOString(), to: to.toISOString() };
  };

  it('starts at the year the person joined in', () =>
    expect(
      windowOf({ createdAt: '2024-05-01T09:00:00Z', fileBalance: null }),
    ).toEqual({
      from: '2024-01-01T00:00:00.000Z',
      to: '2026-12-31T00:00:00.000Z',
    }));

  it('starts at the year of a balance before the joined one', () =>
    expect(
      windowOf({
        contractStartDate: '2020-11-10',
        createdAt: '2026-11-11',
        fileBalance: file({ daysLeft: 12, balanceOn: '2026-11-05' }),
      }),
    ).toEqual({
      from: '2025-11-10T00:00:00.000Z',
      to: '2027-11-09T00:00:00.000Z',
    }));

  it('is the year asked alone for a year still to come', () =>
    expect(windowOf({ date: '2027-03-01' })).toEqual({
      from: '2027-01-01T00:00:00.000Z',
      to: '2027-12-31T00:00:00.000Z',
    }));
});

describe('countedOn', () => {
  it('countedOn: left before Nov 12 and the leave from it', () =>
    expect(countedOn(input({ extra: [dec21to31] }), '2026-11-12')).toEqual({
      left: { days: 16, workingDays: 12, bonusDays: 3 },
      usedFrom: { days: 11, workingDays: 9, bonusDays: 0 },
      planned: [
        expect.objectContaining({
          startDate: '2026-12-21',
          endDate: '2026-12-31',
        }),
      ],
    }));

  it('lists only the leave that takes from the balance, a request across the date too', () =>
    expect(
      countedOn(
        input({
          extra: [
            nov10to13,
            apr6bonus,
            leave('2026-11-23', '2026-11-24', VacationType.SickLeave),
            leave('2026-11-30', '2026-11-30', VacationType.BonusDay),
          ],
        }),
        '2026-11-12',
      ),
    ).toEqual({
      left: { days: 14, workingDays: 10, bonusDays: 2 },
      usedFrom: { days: 2, workingDays: 2, bonusDays: 1 },
      planned: [
        expect.objectContaining({ startDate: '2026-11-10' }),
        expect.objectContaining({ startDate: '2026-11-30' }),
      ],
    }));

  it('carries over into the year of the date', () =>
    expect(
      countedOn(
        input({ createdAt: '2025-02-01', today: '2026-11-12' }),
        '2026-11-12',
      )!.left,
    ).toEqual({ days: 21, workingDays: 17, bonusDays: 3 }));

  it('is null without a policy', () =>
    expect(countedOn(input({ policy: null }), '2026-11-12')).toBeNull());
});
