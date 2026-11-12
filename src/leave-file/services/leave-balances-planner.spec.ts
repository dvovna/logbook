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

  it('replaces an earlier balance of another date whole', () =>
    expect(
      plan(
        [row({ daysLeft: '12', balanceOn: '2026-11-12' })],
        state({
          balanceOf: { workingDaysLeft: 7, balanceOn: '2026-10-01' },
        }),
      ).balances[0],
    ).toMatchObject({ daysLeft: 12, workingDaysLeft: null }));

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
      { row: 2, reason: REASONS.noPolicy('Anna Novak') },
    ]);
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
      expect(reasonOf([row({ balanceOn: '2026-13-40' })])).toEqual([
        REASONS.invalidDate('Balance on', '2026-13-40'),
      ]));
    it('ambiguous date', () =>
      expect(reasonOf([row({ balanceOn: '3/4/2026' })])).toEqual([
        REASONS.ambiguousDate('Balance on', '3/4/2026'),
      ]));
    it('inconsistent dates', () =>
      expect(
        reasonOf([
          row({ balanceOn: '25/4/2026' }),
          row({
            row: 3,
            email: 'boris@acme.test',
            name: 'Boris',
            balanceOn: '4/25/2026',
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
    it('not a half day', () =>
      expect(reasonOf([row({ bonusDaysLeft: '1.3' })])).toEqual([
        REASONS.notHalf('Bonus days left', '1.3'),
      ]));
    it('a balance after today', () =>
      expect(reasonOf([row({ balanceOn: '2026-11-13' })])).toEqual([
        REASONS.balanceOnFuture('2026-11-13'),
      ]));
    it('a balance outside the current vacation year', () =>
      expect(reasonOf([row({ balanceOn: '2025-12-31' })])).toEqual([
        REASONS.balanceOnOutsideYear('Anna Novak', '1 Jan 2026'),
      ]));
    it('the year follows the row’s new contract start', () =>
      expect(
        reasonOf([
          row({ contractStart: '2020-11-01', balanceOn: '2026-10-31' }),
        ]),
      ).toEqual([REASONS.balanceOnOutsideYear('Anna Novak', '1 Nov 2026')]));
    it('names the person by email without a name', () =>
      expect(reasonOf([row({ name: '', balanceOn: '2025-01-01' })])).toEqual([
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
