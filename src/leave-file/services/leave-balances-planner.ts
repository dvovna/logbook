import { formatDate, getDateOnly } from '@common/utils/date.utils';
import { countedOn } from '@modules/vacation-requests/utils/leave-balance.utils';
import { getCurrentVacationPeriod } from '@modules/vacation-requests/utils/vacation-period.utils';
import { BALANCES_HEADERS } from 'src/leave-file/constants/leave-file-headers';
import { LEAVE_FILE_UNUSABLE_REASONS as REASONS } from 'src/leave-file/constants/leave-file-unusable-reasons';
import {
  parseDays,
  parseFileDate,
  SlashOrder,
  slashOrderOf,
} from 'src/leave-file/parsers/leave-file-values';
import {
  ILeaveBalancesPlan,
  ILeaveBalancesState,
} from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveBalanceRow } from 'src/leave-file/types/leave-file-row.interface';
import {
  badDateReason,
  indexPeopleByEmail,
  normalizeEmail,
} from 'src/leave-file/utils/leave-file-people';

const [, , CONTRACT_START, BALANCE_ON, DAYS_LEFT, WORKING_DAYS, BONUS_DAYS] =
  BALANCES_HEADERS;

type Counts = [number | null, number | null, number | null];

const readCounts = (
  row: ILeaveBalanceRow,
): { counts: Counts } | { reason: string } => {
  const cells: [string, string][] = [
    [DAYS_LEFT, row.daysLeft],
    [WORKING_DAYS, row.workingDaysLeft],
    [BONUS_DAYS, row.bonusDaysLeft],
  ];
  const counts: (number | null)[] = [];
  for (const [column, text] of cells) {
    const count = parseDays(text);
    if (count.kind === 'invalid')
      return { reason: REASONS.invalidDays(column, text.trim()) };
    if (count.kind === 'not-half')
      return { reason: REASONS.notHalf(column, text.trim()) };
    counts.push(count.kind === 'days' ? count.value : null);
  }
  return { counts: counts as Counts };
};

export function planLeaveBalances(
  rows: ILeaveBalanceRow[],
  state: ILeaveBalancesState,
): ILeaveBalancesPlan {
  const plan: ILeaveBalancesPlan = {
    balances: [],
    contractStarts: [],
    unchanged: 0,
    unusable: [],
  };
  const peopleByEmail = indexPeopleByEmail(state.people);
  const firstRowOf = new Map<string, number>();
  const order: SlashOrder = slashOrderOf(
    rows.flatMap((row) => [row.contractStart, row.balanceOn]),
  );
  const today = new Date(state.today);

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const person = peopleByEmail.get(email);
    const name = row.name.trim() || row.email.trim();
    const unusable = (reason: string) =>
      plan.unusable.push({ row: row.row, reason });

    if (!email) {
      unusable(REASONS.noEmail);
      continue;
    }
    if (!person) {
      unusable(REASONS.notInWorkspace(row.email.trim()));
      continue;
    }
    if (!person.is_active) {
      unusable(REASONS.deactivated(name));
      continue;
    }
    const earlierRow = firstRowOf.get(person.id);
    if (earlierRow !== undefined) {
      unusable(REASONS.duplicate(name, earlierRow));
      continue;
    }
    firstRowOf.set(person.id, row.row);

    const contractStart = parseFileDate(row.contractStart, order);
    const contractReason = badDateReason(
      contractStart,
      CONTRACT_START,
      row.contractStart.trim(),
    );
    if (contractReason) {
      unusable(contractReason);
      continue;
    }
    const before = person.contract_start_date ?? null;
    const newStart = contractStart.kind === 'date' ? contractStart.value : null;
    const startChanges = newStart !== null && newStart !== before;
    const contractStartDate = newStart ?? before;

    // A valid contract start applies whatever the balance part says, and a
    // row that gives no count sets no balance, so its Balance on is not read.
    if (startChanges) {
      plan.contractStarts.push({ userId: person.id, before, after: newStart });
    }
    const givesCount = [
      row.daysLeft,
      row.workingDaysLeft,
      row.bonusDaysLeft,
    ].some((text) => text.trim() !== '');
    if (!givesCount) {
      if (!startChanges) plan.unchanged++;
      continue;
    }

    const balanceOnDate = parseFileDate(row.balanceOn, order);
    const balanceReason = badDateReason(
      balanceOnDate,
      BALANCE_ON,
      row.balanceOn.trim(),
    );
    if (balanceReason) {
      unusable(balanceReason);
      continue;
    }
    const balanceOn =
      balanceOnDate.kind === 'date' ? balanceOnDate.value : state.today;
    if (balanceOn > state.today) {
      unusable(REASONS.balanceOnFuture(formatDate(balanceOn)));
      continue;
    }
    const yearStart = getDateOnly(
      getCurrentVacationPeriod(contractStartDate, today).periodStart,
    );
    if (balanceOn < yearStart) {
      unusable(REASONS.balanceOnOutsideYear(name, formatDate(yearStart)));
      continue;
    }

    const read = readCounts(row);
    if ('reason' in read) {
      unusable(read.reason);
      continue;
    }
    let counts = read.counts;
    const policy = state.policyOf.get(person.id) ?? null;
    if (!policy) {
      unusable(REASONS.noPolicy(name));
      continue;
    }

    // An earlier balance's counts were left on its own day: only a row for
    // that same day may keep the ones this row leaves empty.
    const earlier = state.balanceOf.get(person.id);
    if (earlier?.balanceOn === balanceOn) {
      const kept = [
        earlier.daysLeft,
        earlier.workingDaysLeft,
        earlier.bonusDaysLeft,
      ];
      counts = counts.map((count, i) => count ?? kept[i]) as Counts;
      if (counts.every((count, i) => count === kept[i])) {
        if (!startChanges) plan.unchanged++;
        continue;
      }
    }

    const counted = countedOn(
      {
        contractStartDate,
        createdAt: person.created_at,
        carryoverDays: person.carryover_days ?? null,
        policy,
        requests: state.requestsOf.get(person.id) ?? [],
        today,
      },
      balanceOn,
    )!;
    const [days, workingDays, bonusDays] = counts;
    const left = (count: number | null, used: number) =>
      count === null ? null : count - used;

    plan.balances.push({
      userId: person.id,
      balanceOn,
      daysLeft: days,
      workingDaysLeft: workingDays,
      bonusDaysLeft: bonusDays,
      counted: counted.left,
      planned: counted.planned.map((request) => ({
        type: request.type,
        startDate: request.startDate,
        endDate: request.endDate,
      })),
      after: {
        days: left(days, counted.usedFrom.days),
        workingDays: left(workingDays, counted.usedFrom.workingDays),
        bonusDays: left(bonusDays, counted.usedFrom.bonusDays),
      },
    });
  }
  const setBalance = new Set(plan.balances.map(({ userId }) => userId));
  const yearStartOf = (contractStart: string | null) =>
    getDateOnly(getCurrentVacationPeriod(contractStart, today).periodStart);

  for (const change of plan.contractStarts) {
    const kept = setBalance.has(change.userId)
      ? undefined
      : state.balanceOf.get(change.userId);

    // In the current year before, out of it now: then it is in the year
    // just before the current one, since it is no later than today.
    if (
      kept &&
      kept.balanceOn >= yearStartOf(change.before) &&
      kept.balanceOn < yearStartOf(change.after)
    ) {
      change.movedBalanceOn = kept.balanceOn;
    }
  }

  return plan;
}

// Unusable rows are only what the file says, not changes.
export const balancesPlanChangesNothing = (plan: ILeaveBalancesPlan) =>
  !plan.balances.length && !plan.contractStarts.length;
