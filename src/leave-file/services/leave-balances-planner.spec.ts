import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { digestOf } from '@common/utils/digest.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  ICountedRequest,
  IFileBalance,
} from '@modules/vacation-requests/utils/leave-balance.utils';
import { LEAVE_FILE_UNUSABLE_REASONS as REASONS } from 'src/leave-file/constants/leave-file-unusable-reasons';
import {
  balancesPlanChangesNothing,
  planLeaveBalances,
} from 'src/leave-file/services/leave-balances-planner';
import { ILeaveBalancesState } from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveBalanceRow } from 'src/leave-file/types/leave-file-row.interface';

const POLICY = {
  id: 'policy-1',
  name: 'Policy',
  slack_team_id: 'slack-team-1',
  vacation_days: 26,
  working_days: 20,
  carryover_days: 5,
  bonus_days: 3,
} as IVacationPolicyViewModel;

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

const leave = (startDate: string, endDate: string): ICountedRequest => ({
  id: `leave-${startDate}`,
  status: VacationRequestStatus.Approved,
  type: VacationType.AnnualLeave,
  startDate,
  endDate,
  workingDates: weekdays(startDate, endDate),
});

const mar2to11 = leave('2026-03-02', '2026-03-11');
const dec21to31 = leave('2026-12-21', '2026-12-31');

const person = (overrides: Partial<IUserViewModel>): IUserViewModel => ({
  id: 'anna-id',
  email: 'anna.novak@acme.test',
  name: 'Anna Novak',
  role: UserRole.Member,
  is_active: true,
  contract_start_date: null,
  carryover_days: null,
  team_id: null,
  slack_team_id: 'slack-team-1',
  slack_id: 'U1',
  created_at: '2026-01-01',
  ...overrides,
});

const anna = person({});
const boris = person({
  id: 'boris-id',
  email: 'boris@acme.test',
  name: 'Boris',
  slack_id: 'U2',
});

const state = ({
  extra = [],
  people = [anna, boris],
  policy = POLICY as IVacationPolicyViewModel | null,
  balanceOf,
}: {
  extra?: ICountedRequest[];
  people?: IUserViewModel[];
  policy?: IVacationPolicyViewModel | null;
  balanceOf?: Partial<IFileBalance>;
} = {}): ILeaveBalancesState => ({
  today: '2026-11-12',
  people,
  policyOf: new Map(people.map((p) => [p.id, policy])),
  requestsOf: new Map(people.map((p) => [p.id, [mar2to11, ...extra]])),
  balanceOf: new Map(
    balanceOf
      ? [
          [
            anna.id,
            {
              balanceOn: '2026-11-12',
              daysLeft: null,
              workingDaysLeft: null,
              bonusDaysLeft: null,
              ...balanceOf,
            },
          ],
        ]
      : [],
  ),
});

const row = (overrides: Partial<ILeaveBalanceRow> = {}): ILeaveBalanceRow => ({
  row: 2,
  name: 'Anna Novak',
  email: 'anna.novak@acme.test',
  contractStart: '',
  balanceOn: '',
  daysLeft: '',
  workingDaysLeft: '',
  bonusDaysLeft: '',
  ...overrides,
});

const plan = planLeaveBalances;
const reasonOf = (rows: ILeaveBalanceRow[], s: ILeaveBalancesState = state()) =>
  plan(rows, s).unusable.map((u) => u.reason);

describe('planLeaveBalances', () => {
  it('plans a balance with what Logbook counts and the leave after it', () =>
    expect(
      plan([row({ daysLeft: '12' })], state({ extra: [dec21to31] })).balances,
    ).toEqual([
      {
        userId: anna.id,
        balanceOn: '2026-11-12',
        daysLeft: 12,
        workingDaysLeft: null,
        bonusDaysLeft: null,
        counted: { days: 16, workingDays: 12, bonusDays: 3 },
        planned: [
          {
            type: VacationType.AnnualLeave,
            startDate: '2026-12-21',
            endDate: '2026-12-31',
          },
        ],
        after: { days: 1, workingDays: null, bonusDays: null },
      },
    ]));

  it('matches an email ignoring case and spaces', () =>
    expect(
      plan([row({ email: ' Anna.Novak@Acme.test ', daysLeft: '12' })], state())
        .unusable,
    ).toEqual([]));

  it('reads slash dates of the whole file the same way', () =>
    expect(
      plan(
        [
          row({
            contractStart: '4/15/2021',
            balanceOn: '11/12/2026',
            daysLeft: '12',
          }),
        ],
        state(),
      ).contractStarts,
    ).toEqual([{ userId: anna.id, before: null, after: '2021-04-15' }]));

  it('keeps the earlier working days of a balance on the same date', () =>
    expect(
      plan(
        [row({ daysLeft: '12' })],
        state({
          balanceOf: { workingDaysLeft: 7, balanceOn: '2026-11-12' },
        }),
      ).balances[0],
    ).toMatchObject({ daysLeft: 12, workingDaysLeft: 7 }));

  describe('an earlier balance of another date', () => {
    // 2 working days, 5-6 Oct, and a bonus day on 9 Oct.
    const october = [
      leave('2026-10-05', '2026-10-06'),
      { ...leave('2026-10-09', '2026-10-09'), type: VacationType.BonusDay },
    ];

    it('in the same year carries the units the row leaves empty to its later date, less the leave between', () =>
      expect(
        plan(
          [row({ daysLeft: '12', balanceOn: '2026-11-12' })],
          state({
            extra: october,
            balanceOf: {
              balanceOn: '2026-10-01',
              daysLeft: 20,
              workingDaysLeft: 7,
              bonusDaysLeft: 2,
            },
          }),
        ).balances,
      ).toEqual([
        expect.objectContaining({
          balanceOn: '2026-11-12',
          daysLeft: 12,
          workingDaysLeft: 5,
          bonusDaysLeft: 1,
          after: { days: 12, workingDays: 5, bonusDays: 1 },
        }),
      ]));

    it('in the same year carries them to its earlier date, plus the leave between', () =>
      expect(
        plan(
          [row({ daysLeft: '12', balanceOn: '2026-10-01' })],
          state({
            extra: october,
            balanceOf: { balanceOn: '2026-11-12', workingDaysLeft: 5 },
          }),
        ).balances,
      ).toEqual([
        expect.objectContaining({
          balanceOn: '2026-10-01',
          daysLeft: 12,
          workingDaysLeft: 7,
          bonusDaysLeft: null,
          // The leave from 1 Oct on takes from both.
          after: { days: 10, workingDays: 5, bonusDays: null },
        }),
      ]));

    it('of another year goes with the units the row leaves empty, which the plan names', () =>
      expect(
        plan(
          [row({ daysLeft: '12' })],
          state({
            balanceOf: {
              balanceOn: '2025-12-01',
              daysLeft: 3,
              workingDaysLeft: 7,
              bonusDaysLeft: 1,
            },
          }),
        ).balances,
      ).toEqual([
        expect.objectContaining({
          daysLeft: 12,
          workingDaysLeft: null,
          bonusDaysLeft: null,
          dropped: {
            balanceOn: '2025-12-01',
            days: null,
            workingDays: 7,
            bonusDays: 1,
          },
        }),
      ]));

    it("of another year by the row's new contract start goes too", () =>
      expect(
        plan(
          [row({ contractStart: '2020-06-15', bonusDaysLeft: '2' })],
          state({ balanceOf: { balanceOn: '2026-06-10', daysLeft: 3 } }),
        ).balances[0],
      ).toMatchObject({
        daysLeft: null,
        bonusDaysLeft: 2,
        dropped: {
          balanceOn: '2026-06-10',
          days: 3,
          workingDays: null,
          bonusDays: null,
        },
      }));

    it('names nothing dropped when the row gives every unit the earlier one had', () =>
      expect(
        plan(
          [row({ daysLeft: '12' })],
          state({ balanceOf: { balanceOn: '2025-12-01', daysLeft: 3 } }),
        ).balances[0],
      ).not.toHaveProperty('dropped'));
  });

  it('counts a row that repeats the earlier balance as unchanged', () => {
    const result = plan(
      [row({ daysLeft: '12' })],
      state({ balanceOf: { daysLeft: 12 } }),
    );
    expect(result.balances).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it('takes an empty Balance on as today', () =>
    expect(plan([row({ daysLeft: '12' })], state()).balances[0].balanceOn).toBe(
      '2026-11-12',
    ));

  it('reads 12,5 as 12.5', () =>
    expect(
      plan([row({ daysLeft: '12,5' })], state()).balances[0].daysLeft,
    ).toBe(12.5));

  it('counts an all-empty row only as unchanged', () => {
    const result = plan([row()], state());
    expect(result).toEqual({
      balances: [],
      contractStarts: [],
      unchanged: 1,
      unusable: [],
    });
    expect(balancesPlanChangesNothing(result)).toBe(true);
  });

  it('a contract start alone is a change', () => {
    const result = plan([row({ contractStart: '2021-04-15' })], state());
    expect(result.unchanged).toBe(0);
    expect(balancesPlanChangesNothing(result)).toBe(false);
  });

  it('makes a contract start entry only when the date changes', () =>
    expect(
      plan(
        [row({ contractStart: '2021-04-15', daysLeft: '3' })],
        state({ people: [person({ contract_start_date: '2021-04-15' })] }),
      ).contractStarts,
    ).toEqual([]));

  it('a no-policy row still changes its contract start', () => {
    const result = plan(
      [row({ contractStart: '2021-04-15', daysLeft: '12' })],
      state({ policy: null }),
    );
    expect(result.contractStarts).toEqual([
      { userId: anna.id, before: null, after: '2021-04-15' },
    ]);
    expect(result.balances).toEqual([]);
    expect(result.unusable).toEqual([
      {
        row: 2,
        reason: REASONS.contractStartApplies(REASONS.noPolicy('Anna Novak')),
        contractStartApplies: true,
      },
    ]);
  });

  it('applies a changed contract start whatever its Balance on says', () => {
    const result = plan(
      [row({ contractStart: '2021-04-15', balanceOn: '2025-01-01' })],
      state(),
    );
    expect(result.contractStarts).toEqual([
      { userId: anna.id, before: null, after: '2021-04-15' },
    ]);
    expect(result.unusable).toEqual([]);
  });

  it('applies a changed contract start beside a bad count and lists the count', () => {
    const result = plan(
      [row({ contractStart: '2021-04-15', daysLeft: 'lots' })],
      state(),
    );
    expect(result.contractStarts).toHaveLength(1);
    expect(result.balances).toEqual([]);
    expect(result.unusable).toEqual([
      {
        row: 2,
        reason:
          'Days left "lots" isn\'t a number of days (its contract start still applies)',
        contractStartApplies: true,
      },
    ]);
  });

  it('says nothing of a contract start the row gives as it is', () =>
    expect(
      plan(
        [row({ contractStart: '2021-04-15', daysLeft: 'lots' })],
        state({ people: [person({ contract_start_date: '2021-04-15' })] }),
      ).unusable,
    ).toEqual([{ row: 2, reason: REASONS.invalidDays('Days left', 'lots') }]));

  it('applies corrected contract starts from a template made last year', () => {
    const result = plan(
      [row({ contractStart: '2021-04-15', balanceOn: '2026-12-20' })],
      { ...state(), today: '2027-01-05' },
    );
    expect(result.contractStarts).toEqual([
      { userId: anna.id, before: null, after: '2021-04-15' },
    ]);
    expect(result.unusable).toEqual([]);
  });

  describe('a kept balance and a new contract start', () => {
    // Anna's file balance of 10 Jun stays: the row sets no balance.
    const kept = state({ balanceOf: { balanceOn: '2026-06-10', daysLeft: 3 } });

    it('notes the balance it moves into the year before', () =>
      expect(
        plan([row({ contractStart: '2020-06-15' })], kept).contractStarts,
      ).toEqual([
        {
          userId: anna.id,
          before: null,
          after: '2020-06-15',
          movedBalanceOn: '2026-06-10',
        },
      ]));

    it('notes nothing when the balance stays in the current year', () =>
      expect(
        plan([row({ contractStart: '2020-03-01' })], kept).contractStarts,
      ).toEqual([{ userId: anna.id, before: null, after: '2020-03-01' }]));

    it('notes nothing when the row sets a new balance', () =>
      expect(
        plan(
          [
            row({
              contractStart: '2020-06-15',
              balanceOn: '2026-11-12',
              daysLeft: '5',
            }),
          ],
          kept,
        ).contractStarts,
      ).toEqual([{ userId: anna.id, before: null, after: '2020-06-15' }]));

    it('notes nothing of a balance that was in an earlier year already', () =>
      expect(
        plan(
          [row({ contractStart: '2020-06-15' })],
          state({ balanceOf: { balanceOn: '2025-12-01', daysLeft: 3 } }),
        ).contractStarts,
      ).toEqual([{ userId: anna.id, before: null, after: '2020-06-15' }]));
  });

  describe('unusable rows', () => {
    it('no email', () =>
      expect(reasonOf([row({ email: '  ' })])).toEqual([REASONS.noEmail]));
    it('not in the workspace', () =>
      expect(reasonOf([row({ email: 'x@acme.test' })])).toEqual([
        REASONS.notInWorkspace('x@acme.test'),
      ]));
    it('deactivated', () =>
      expect(
        reasonOf(
          [row({ daysLeft: '1' })],
          state({ people: [person({ is_active: false })] }),
        ),
      ).toEqual([REASONS.deactivated('Anna Novak')]));
    it('a second row of one person', () =>
      expect(
        reasonOf([row({ daysLeft: '1' }), row({ row: 5, daysLeft: '2' })]),
      ).toEqual([REASONS.duplicate('Anna Novak', 2)]));
    it('invalid contract start', () =>
      expect(reasonOf([row({ contractStart: 'soon' })])).toEqual([
        REASONS.invalidDate('Contract start', 'soon'),
      ]));
    it('invalid balance on', () =>
      expect(
        reasonOf([row({ balanceOn: '2026-13-40', daysLeft: '1' })]),
      ).toEqual([REASONS.invalidDate('Balance on', '2026-13-40')]));
    it('ambiguous date', () =>
      expect(reasonOf([row({ balanceOn: '3/4/2026', daysLeft: '1' })])).toEqual(
        [REASONS.ambiguousDate('Balance on', '3/4/2026')],
      ));
    it('inconsistent dates', () =>
      expect(
        reasonOf([
          row({ balanceOn: '25/4/2026', daysLeft: '1' }),
          row({
            row: 3,
            email: 'boris@acme.test',
            name: 'Boris',
            balanceOn: '4/25/2026',
            daysLeft: '1',
          }),
        ]),
      ).toEqual([
        REASONS.inconsistentDates('Balance on', '25/4/2026'),
        REASONS.inconsistentDates('Balance on', '4/25/2026'),
      ]));
    it('invalid days', () =>
      expect(reasonOf([row({ daysLeft: 'lots' })])).toEqual([
        REASONS.invalidDays('Days left', 'lots'),
      ]));
    it('more than a year of days', () =>
      expect(reasonOf([row({ workingDaysLeft: '10000' })])).toEqual([
        REASONS.moreThanAYear('Working days left', '10000'),
      ]));
    it('not a half day', () =>
      expect(reasonOf([row({ bonusDaysLeft: '1.3' })])).toEqual([
        REASONS.notHalf('Bonus days left', '1.3'),
      ]));
    it('a balance after today', () =>
      expect(
        reasonOf([row({ balanceOn: '2026-11-13', daysLeft: '1' })]),
      ).toEqual([REASONS.balanceOnFuture('13 Nov 2026')]));
    it('a balance outside the current vacation year', () =>
      expect(
        reasonOf([row({ balanceOn: '2025-12-31', daysLeft: '1' })]),
      ).toEqual([REASONS.balanceOnOutsideYear('Anna Novak', '1 Jan 2026')]));
    it('the year follows the row’s new contract start', () =>
      expect(
        reasonOf([
          row({
            contractStart: '2020-11-01',
            balanceOn: '2026-10-31',
            daysLeft: '1',
          }),
        ]),
      ).toEqual([
        REASONS.contractStartApplies(
          REASONS.balanceOnOutsideYear('Anna Novak', '1 Nov 2026'),
        ),
      ]));
    it('names the person by email without a name', () =>
      expect(
        reasonOf([row({ name: '', balanceOn: '2025-01-01', daysLeft: '1' })]),
      ).toEqual([
        REASONS.balanceOnOutsideYear('anna.novak@acme.test', '1 Jan 2026'),
      ]));
    it('no policy', () =>
      expect(
        reasonOf([row({ daysLeft: '1' })], state({ policy: null })),
      ).toEqual([REASONS.noPolicy('Anna Novak')]));
  });

  it('gives the same digest for a plan with its lists reordered', () => {
    const rows = [
      row({ daysLeft: '12' }),
      row({ row: 3, email: 'boris@acme.test', name: 'Boris', daysLeft: '4' }),
    ];
    const a = plan(rows, state());
    const b = plan([...rows].reverse(), state());
    expect(digestOf(a)).toBe(digestOf(b));
    expect(a.balances).toHaveLength(2);
  });
});
