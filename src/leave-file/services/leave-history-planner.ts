import { MAX_COMMENT_LENGTH } from '@common/constants/text-limits';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import {
  DAY_MS,
  formatDate,
  formatDateRange,
  getDateOnly,
} from '@common/utils/date.utils';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  countedOn,
  ICountedRequest,
  ILeaveBalanceInput,
  ILeft,
  leaveBalanceOf,
} from '@modules/vacation-requests/utils/leave-balance.utils';
import { getCurrentVacationPeriod } from '@modules/vacation-requests/utils/vacation-period.utils';
import { HISTORY_HEADERS } from 'src/leave-file/constants/leave-file-headers';
import {
  MAX_LEAVE_AHEAD_DAYS,
  MAX_LEAVE_DAYS,
} from 'src/leave-file/constants/leave-file-limits';
import { LEAVE_FILE_TYPE_NAMES } from 'src/leave-file/constants/leave-file-type-names';
import { LEAVE_FILE_UNUSABLE_REASONS as REASONS } from 'src/leave-file/constants/leave-file-unusable-reasons';
import {
  parseFileDate,
  SlashOrder,
  slashOrderOf,
} from 'src/leave-file/parsers/leave-file-values';
import {
  ILeaveHistoryPlan,
  ILeaveHistoryState,
} from 'src/leave-file/types/leave-history-plan.interface';
import { ILeaveHistoryRow } from 'src/leave-file/types/leave-file-row.interface';
import {
  badDateReason,
  indexPeopleByEmail,
  normalizeEmail,
} from 'src/leave-file/utils/leave-file-people';

const [, , , FROM, TO] = HISTORY_HEADERS;

const squash = (text: string) => text.replace(/\s+/g, '').toLowerCase();

const typeOf = (text: string): VacationType | null => {
  const wanted = squash(text);
  if (!wanted) return null;
  return (
    Object.values(VacationType).find(
      (type) =>
        squash(type) === wanted ||
        squash(LEAVE_FILE_TYPE_NAMES[type]) === wanted,
    ) ?? null
  );
};

const overlaps = (
  a: { startDate: string; endDate: string },
  b: { startDate: string; endDate: string },
) => a.startDate <= b.endDate && b.startDate <= a.endDate;

const leftOf = (input: ILeaveBalanceInput): ILeft => {
  const { usage } = leaveBalanceOf(input);
  return {
    days: usage[VacationType.AnnualLeave].available,
    workingDays: usage[VacationType.AnnualLeave].working_days_available,
    bonusDays: usage[VacationType.BonusDay].available,
  };
};

const sameLeft = (a: ILeft, b: ILeft) =>
  a.days === b.days &&
  a.workingDays === b.workingDays &&
  a.bonusDays === b.bonusDays;

export function planLeaveHistory(
  rows: ILeaveHistoryRow[],
  state: ILeaveHistoryState,
): ILeaveHistoryPlan {
  const plan: ILeaveHistoryPlan = {
    add: [],
    skipped: 0,
    balanceChanges: [],
    plannedLeave: [],
    unusable: [],
  };
  const peopleByEmail = indexPeopleByEmail(state.people);
  const order: SlashOrder = slashOrderOf(
    rows.flatMap((row) => [row.from, row.to]),
  );
  const latest = new Date(
    new Date(state.today).getTime() + MAX_LEAVE_AHEAD_DAYS * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
  const addedBy = new Map<string, ICountedRequest[]>();
  const rowOf = new Map<string, number>();

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

    const type = typeOf(row.leaveType);
    if (!type) {
      unusable(REASONS.unknownType(row.leaveType.trim()));
      continue;
    }

    const from = parseFileDate(row.from, order);
    const to = parseFileDate(row.to, order);
    const dateReason =
      badDateReason(from, FROM, row.from.trim()) ??
      badDateReason(to, TO, row.to.trim());
    if (dateReason) {
      unusable(dateReason);
      continue;
    }
    if (from.kind !== 'date' || to.kind !== 'date') {
      unusable(REASONS.missingDates);
      continue;
    }
    const range = { startDate: from.value, endDate: to.value };
    if (range.endDate < range.startDate) {
      unusable(REASONS.endsBeforeStart);
      continue;
    }
    if (range.endDate > latest) {
      unusable(REASONS.tooFarAhead(formatDate(range.endDate)));
      continue;
    }
    if (
      getDaysBetweenDates(new Date(range.startDate), new Date(range.endDate)) >
      MAX_LEAVE_DAYS
    ) {
      unusable(
        REASONS.longerThanAYear(
          formatDate(range.startDate),
          formatDate(range.endDate),
        ),
      );
      continue;
    }

    const comment = row.comment.trim();
    if (comment.length > MAX_COMMENT_LENGTH) {
      unusable(REASONS.commentTooLong);
      continue;
    }

    const existing = state.requestsOf.get(person.id) ?? [];
    const inLogbook = (request: ICountedRequest) =>
      request.status === VacationRequestStatus.Approved ||
      request.status === VacationRequestStatus.Pending;
    if (
      existing.some(
        (request) =>
          inLogbook(request) &&
          request.type === type &&
          request.startDate === range.startDate &&
          request.endDate === range.endDate,
      )
    ) {
      plan.skipped++;
      continue;
    }
    const clash = existing.find(
      (request) => inLogbook(request) && overlaps(request, range),
    );
    if (clash) {
      unusable(
        REASONS.overlapsRequest(
          name,
          LEAVE_FILE_TYPE_NAMES[clash.type].toLowerCase(),
          formatDateRange(clash.startDate, clash.endDate),
        ),
      );
      continue;
    }
    const earlier = (addedBy.get(person.id) ?? []).find((added) =>
      overlaps(added, range),
    );
    if (earlier) {
      unusable(REASONS.overlapsRow(rowOf.get(earlier.id)!));
      continue;
    }

    // No more requests than Logbook lets a person make (validateRequestLimits).
    const added = addedBy.get(person.id) ?? [];
    if (
      (state.requestCountOf.get(person.id) ?? 0) + added.length >=
      state.maxRequestsPerUser
    ) {
      unusable(REASONS.tooManyRequests(name, state.maxRequestsPerUser));
      continue;
    }

    const id = `row-${row.row}`;
    rowOf.set(id, row.row);
    addedBy.set(person.id, [
      ...added,
      {
        id,
        status: VacationRequestStatus.Approved,
        type,
        ...range,
        workingDates: state.workingDatesOf(
          person.id,
          range.startDate,
          range.endDate,
        ),
      },
    ]);
    plan.add.push({
      row: row.row,
      userId: person.id,
      type,
      ...range,
      comment: comment || null,
    });
  }

  const today = new Date(state.today);
  for (const [userId, added] of addedBy) {
    const person = state.people.find((p) => p.id === userId) as IUserViewModel;
    const policy = state.policyOf.get(userId) ?? null;
    if (!policy) continue;
    const input = {
      contractStartDate: person.contract_start_date ?? null,
      createdAt: person.created_at,
      carryoverDays: person.carryover_days ?? null,
      policy,
      requests: state.requestsOf.get(userId) ?? [],
      today,
    };
    const fileBalance = state.balanceOf.get(userId) ?? null;
    const after = [...input.requests, ...added];
    const yearStart = getDateOnly(
      getCurrentVacationPeriod(input.contractStartDate, today).periodStart,
    );

    // A file balance of an earlier year only carries over into this one,
    // which shows in what is available today, as for someone with none.
    if (!fileBalance || fileBalance.balanceOn < yearStart) {
      const before = leftOf({ ...input, fileBalance, date: today });
      const next = leftOf({
        ...input,
        requests: after,
        fileBalance,
        date: today,
      });
      if (!sameLeft(before, next)) {
        plan.balanceChanges.push({ userId, before, after: next });
      }
      continue;
    }

    const counted = countedOn(
      { ...input, requests: after },
      fileBalance.balanceOn,
    )!;
    const addedIds = new Set(added.map((request) => request.id));
    const leave = counted.planned
      .filter((request) => addedIds.has(request.id))
      .map(({ type, startDate, endDate }) => ({ type, startDate, endDate }));
    if (!leave.length) continue;
    const left = (count: number | null, used: number) =>
      count === null ? null : count - used;
    plan.plannedLeave.push({
      userId,
      balanceOn: fileBalance.balanceOn,
      leave,
      left: {
        days: fileBalance.daysLeft,
        workingDays: fileBalance.workingDaysLeft,
        bonusDays: fileBalance.bonusDaysLeft,
      },
      after: {
        days: left(fileBalance.daysLeft, counted.usedFrom.days),
        workingDays: left(
          fileBalance.workingDaysLeft,
          counted.usedFrom.workingDays,
        ),
        bonusDays: left(fileBalance.bonusDaysLeft, counted.usedFrom.bonusDays),
      },
    });
  }
  return plan;
}

export const historyPlanChangesNothing = (plan: ILeaveHistoryPlan) =>
  !plan.add.length;
