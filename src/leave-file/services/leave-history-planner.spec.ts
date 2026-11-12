import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  ICountedRequest,
  IFileBalance,
} from '@modules/vacation-requests/utils/leave-balance.utils';
import { LEAVE_FILE_UNUSABLE_REASONS as REASONS } from 'src/leave-file/constants/leave-file-unusable-reasons';
import {
  historyPlanChangesNothing,
  planLeaveHistory,
} from 'src/leave-file/services/leave-history-planner';
import { ILeaveHistoryState } from 'src/leave-file/types/leave-history-plan.interface';
import { ILeaveHistoryRow } from 'src/leave-file/types/leave-file-row.interface';

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

const existing = (
  startDate: string,
  endDate: string,
  type = VacationType.AnnualLeave,
  status = VacationRequestStatus.Approved,
): ICountedRequest => ({
  id: `existing-${startDate}`,
  status,
  type,
  startDate,
  endDate,
  workingDates: weekdays(startDate, endDate),
});

const anna: IUserViewModel = {
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
};
const boris: IUserViewModel = {
  ...anna,
  id: 'boris-id',
  email: 'boris@acme.test',
  name: 'Boris',
  slack_id: 'U2',
  is_active: false,
};

const state = ({
  requests = [] as ICountedRequest[],
  balanceOf,
  policy = POLICY as IVacationPolicyViewModel | null,
}: {
  requests?: ICountedRequest[];
  balanceOf?: IFileBalance;
  policy?: IVacationPolicyViewModel | null;
} = {}): ILeaveHistoryState => ({
  today: '2026-11-12',
  people: [anna, boris],
  policyOf: new Map([
    [anna.id, policy],
    [boris.id, policy],
  ]),
  requestsOf: new Map([[anna.id, requests]]),
  balanceOf: new Map(balanceOf ? [[anna.id, balanceOf]] : []),
  workingDatesOf: (_user, start, end) => weekdays(start, end),
});

const row = (overrides: Partial<ILeaveHistoryRow> = {}): ILeaveHistoryRow => ({
  row: 2,
  name: 'Anna Novak',
  email: 'anna.novak@acme.test',
  leaveType: 'Annual leave',
  from: '2026-12-01',
  to: '2026-12-10',
  comment: '',
  ...overrides,
});

const reasonOf = (rows: ILeaveHistoryRow[], s = state()) =>
  planLeaveHistory(rows, s).unusable.map((u) => u.reason);

describe('planLeaveHistory', () => {
  it('adds a usable row with its comment', () =>
    expect(planLeaveHistory([row({ comment: ' Trip ' })], state()).add).toEqual(
      [
        {
          row: 2,
          userId: anna.id,
          type: VacationType.AnnualLeave,
          startDate: '2026-12-01',
          endDate: '2026-12-10',
          comment: 'Trip',
        },
      ],
    ));

  it('says no comment is null', () =>
    expect(planLeaveHistory([row()], state()).add[0].comment).toBeNull());

  it.each([
    ['annual leave', VacationType.AnnualLeave],
    ['ANNUAL  LEAVE', VacationType.AnnualLeave],
    ['annual_leave', VacationType.AnnualLeave],
    ['Bonus day', VacationType.BonusDay],
    [' sick leave ', VacationType.SickLeave],
    ['Unpaid Leave', VacationType.UnpaidLeave],
    ['OTHER', VacationType.Other],
  ])('reads the type %s', (leaveType, type) =>
    expect(planLeaveHistory([row({ leaveType })], state()).add[0].type).toBe(
      type,
    ),
  );

  it('finds a person by email in any case', () =>
    expect(
      planLeaveHistory([row({ email: ' Anna.Novak@ACME.test ' })], state()).add,
    ).toHaveLength(1));

  it('refuses rows with no email, an unknown or a deactivated person', () =>
    expect(
      reasonOf([
        row({ email: '' }),
        row({ email: 'nobody@acme.test' }),
        row({ email: 'boris@acme.test', name: 'Boris' }),
      ]),
    ).toEqual([
      REASONS.noEmail,
      REASONS.notInWorkspace('nobody@acme.test'),
      REASONS.deactivated('Boris'),
    ]));

  it('refuses an unknown type', () =>
    expect(reasonOf([row({ leaveType: 'Holiday' })])).toEqual([
      REASONS.unknownType('Holiday'),
    ]));

  it('refuses missing dates', () =>
    expect(reasonOf([row({ to: '' }), row({ from: '', to: '' })])).toEqual([
      REASONS.missingDates,
      REASONS.missingDates,
    ]));

  it('refuses bad dates with their column', () =>
    expect(
      reasonOf([row({ from: 'soon' }), row({ to: '2026-02-30' })]),
    ).toEqual([
      REASONS.invalidDate('From', 'soon'),
      REASONS.invalidDate('To', '2026-02-30'),
    ]));

  it('refuses slashes that mix orders across the file', () =>
    expect(
      reasonOf([
        row({ row: 2, from: '13/01/2026', to: '14/01/2026' }),
        row({ row: 3, from: '01/13/2026', to: '01/14/2026' }),
      ]),
    ).toEqual([
      REASONS.inconsistentDates('From', '13/01/2026'),
      REASONS.inconsistentDates('From', '01/13/2026'),
    ]));

  it('refuses a To before From', () =>
    expect(reasonOf([row({ from: '2026-12-10', to: '2026-12-01' })])).toEqual([
      REASONS.endsBeforeStart,
    ]));

  it('refuses a To more than a year ahead', () => {
    expect(reasonOf([row({ from: '2027-11-01', to: '2027-11-14' })])).toEqual([
      REASONS.tooFarAhead('14 Nov 2027'),
    ]);
    expect(
      planLeaveHistory([row({ from: '2027-11-01', to: '2027-11-13' })], state())
        .add,
    ).toHaveLength(1);
  });

  it('refuses a long comment', () =>
    expect(
      reasonOf([row({ comment: 'x'.repeat(MAX_COMMENT_LENGTH + 1) })]),
    ).toEqual([REASONS.commentTooLong]));

  it('skips an exact repeat of an approved or pending request', () => {
    const result = planLeaveHistory(
      [row({ row: 2 }), row({ row: 3, from: '2026-12-15', to: '2026-12-16' })],
      state({
        requests: [
          existing('2026-12-01', '2026-12-10'),
          existing(
            '2026-12-15',
            '2026-12-16',
            VacationType.AnnualLeave,
            VacationRequestStatus.Pending,
          ),
        ],
      }),
    );
    expect(result.skipped).toBe(2);
    expect(result.unusable).toEqual([]);
    expect(result.add).toEqual([]);
    expect(historyPlanChangesNothing(result)).toBe(true);
  });

  it('does not skip a repeat of another type or a canceled request', () => {
    const result = planLeaveHistory(
      [row({ leaveType: 'Sick leave' })],
      state({
        requests: [
          existing(
            '2026-12-01',
            '2026-12-10',
            VacationType.AnnualLeave,
            VacationRequestStatus.Approved,
          ),
        ],
      }),
    );
    expect(result.skipped).toBe(0);
    expect(result.unusable).toEqual([
      { row: 2, reason: "overlaps Anna Novak's annual leave 1–10 Dec 2026" },
    ]);
  });

  it('refuses an overlap with an approved or pending request', () =>
    expect(
      reasonOf(
        [row({ from: '2026-12-08', to: '2026-12-20' })],
        state({
          requests: [
            existing(
              '2026-12-01',
              '2026-12-10',
              VacationType.SickLeave,
              VacationRequestStatus.Pending,
            ),
          ],
        }),
      ),
    ).toEqual([
      REASONS.overlapsRequest('Anna Novak', 'sick leave', '1–10 Dec 2026'),
    ]));

  it('ignores canceled and rejected requests', () =>
    expect(
      planLeaveHistory(
        [row()],
        state({
          requests: [
            existing(
              '2026-12-01',
              '2026-12-10',
              VacationType.AnnualLeave,
              VacationRequestStatus.Canceled,
            ),
          ],
        }),
      ).add,
    ).toHaveLength(1));

  it('refuses the second of two overlapping rows', () =>
    expect(
      planLeaveHistory(
        [
          row({ row: 2 }),
          row({ row: 3, from: '2026-12-10', to: '2026-12-12' }),
          row({ row: 4, from: '2026-12-11', to: '2026-12-12' }),
        ],
        state(),
      ).unusable,
    ).toEqual([{ row: 3, reason: REASONS.overlapsRow(2) }]));

  it('does not let a refused row block a later one', () =>
    expect(
      planLeaveHistory(
        [row({ row: 2, leaveType: 'Holiday' }), row({ row: 3 })],
        state(),
      ).add.map((a) => a.row),
    ).toEqual([3]));

  it('lists the change of a person with no file balance', () =>
    expect(planLeaveHistory([row()], state()).balanceChanges).toEqual([
      {
        userId: anna.id,
        before: { days: 26, workingDays: 20, bonusDays: 3 },
        after: { days: 16, workingDays: 12, bonusDays: 3 },
      },
    ]));

  it('lists nobody whose availability stays', () =>
    expect(
      planLeaveHistory([row({ leaveType: 'Sick leave' })], state())
        .balanceChanges,
    ).toEqual([]));

  it('lists no change for a person without a policy', () =>
    expect(
      planLeaveHistory([row()], state({ policy: null })).balanceChanges,
    ).toEqual([]));

  it('plans leave from a file balance with what is left after it', () => {
    const result = planLeaveHistory(
      [
        row({ from: '2026-12-21', to: '2026-12-31' }),
        row({ row: 3, from: '2026-03-02', to: '2026-03-04' }),
      ],
      state({
        balanceOf: {
          balanceOn: '2026-11-12',
          daysLeft: 12,
          workingDaysLeft: null,
          bonusDaysLeft: null,
        },
      }),
    );
    expect(result.balanceChanges).toEqual([]);
    expect(result.plannedLeave).toEqual([
      {
        userId: anna.id,
        balanceOn: '2026-11-12',
        leave: [
          {
            type: VacationType.AnnualLeave,
            startDate: '2026-12-21',
            endDate: '2026-12-31',
          },
        ],
        left: { days: 12, workingDays: null, bonusDays: null },
        after: { days: 1, workingDays: null, bonusDays: null },
      },
    ]);
  });

  it('lists nothing planned for leave only before the balance date', () =>
    expect(
      planLeaveHistory(
        [row({ from: '2026-03-02', to: '2026-03-04' })],
        state({
          balanceOf: {
            balanceOn: '2026-11-12',
            daysLeft: 12,
            workingDaysLeft: null,
            bonusDaysLeft: null,
          },
        }),
      ),
    ).toMatchObject({ plannedLeave: [], balanceChanges: [] }));
});
