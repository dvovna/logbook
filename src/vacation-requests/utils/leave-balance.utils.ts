import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { DAY_MS, getDateOnly } from '@common/utils/date.utils';
import getDaysBetweenDates from '@common/utils/get-days-between-dates';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  IVacationLimits,
  IVacationPeriodUsageData,
} from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import {
  getCurrentVacationPeriod,
  getJoinedVacationPeriod,
  getVacationPeriodsBetween,
} from '@modules/vacation-requests/utils/vacation-period.utils';

// One of the person's approved or pending requests with the working days it
// takes.
export interface ICountedRequest {
  id: string;
  status: VacationRequestStatus;
  type: VacationType;
  startDate: string;
  endDate: string;
  workingDates: string[];
}

// What a person had left on `balanceOn`, as HR's file said. A unit the file
// left empty is null.
export interface IFileBalance {
  balanceOn: string;
  daysLeft: number | null;
  workingDaysLeft: number | null;
  bonusDaysLeft: number | null;
}

export const toFileBalance = (balance: ILeaveBalance): IFileBalance => ({
  balanceOn: balance.balance_on,
  daysLeft: balance.days_left,
  workingDaysLeft: balance.working_days_left,
  bonusDaysLeft: balance.bonus_days_left,
});

// A file balance as it is stored, with the upload that set it, who and
// when: what an Undo of a later upload puts back.
export interface IStoredBalance extends IFileBalance {
  uploadId: string | null;
  setBy: string | null;
  updatedAt: string;
}

export const toStoredBalance = (balance: ILeaveBalance): IStoredBalance => ({
  ...toFileBalance(balance),
  uploadId: balance.upload_id,
  setBy: balance.set_by,
  updatedAt: balance.updated_at,
});

export interface ILeaveBalanceInput {
  contractStartDate: string | null;
  createdAt: string;
  carryoverDays: number | null;
  policy: IVacationPolicyViewModel | null;
  requests: ICountedRequest[];
  fileBalance: IFileBalance | null;
  // The balance is the one of the vacation year that holds `date`.
  date: Date;
  today: Date;
}

// Annual leave in calendar and in working days, and bonus days (working
// days): the units a balance has.
export interface ILeft {
  days: number;
  workingDays: number;
  bonusDays: number;
}

interface IYear {
  periodStart: Date;
  periodEnd: Date;
  start: string;
  end: string;
}

type Correction = IVacationLimits['correction'];

interface ICarried {
  carry: { days: number; workingDays: number };
  correction: Correction;
}

const NOTHING_CARRIED: ICarried = {
  carry: { days: 0, workingDays: 0 },
  correction: null,
};

const NO_ALLOWANCE: ILeft = { days: 0, workingDays: 0, bonusDays: 0 };

// The balance of the vacation year that holds `date`. A balance from a file
// is what was left on its day before any leave from that day on, so the year
// that holds it gets the difference to what Logbook counts as a correction,
// and the years after it carry over from it. Neither the leave in Logbook
// before that day nor the carryover HR entered changes a unit the file gives.
export const leaveBalanceOf = (
  input: ILeaveBalanceInput,
): IVacationPeriodUsageData => {
  const { policy, requests } = input;
  const year = yearOf(input.contractStartDate, input.date);
  const taken = takenIn(requests, year.start, year.end);
  const carried = policy ? carriedInto(input, policy, year) : NOTHING_CARRIED;
  const { carry, correction } = carried;
  const allowance = policy ? allowanceOf(policy) : NO_ALLOWANCE;
  // Shown as 0 when overspent.
  const available = (days: number) => Math.max(0, days);

  return {
    periodStart: year.periodStart,
    periodEnd: year.periodEnd,
    limits: policy && limitsOf(policy, carried),
    usage: {
      [VacationType.AnnualLeave]: {
        used: taken.days,
        available: available(
          allowance.days + carry.days + (correction?.days ?? 0) - taken.days,
        ),
        working_days_used: taken.workingDays,
        working_days_available: available(
          allowance.workingDays +
            carry.workingDays +
            (correction?.workingDays ?? 0) -
            taken.workingDays,
        ),
      },
      [VacationType.BonusDay]: {
        used: taken.bonusDays,
        available: available(
          allowance.bonusDays + (correction?.bonusDays ?? 0) - taken.bonusDays,
        ),
      },
      [VacationType.SickLeave]: {
        used: calendarDaysIn(requests, VacationType.SickLeave, year),
      },
      [VacationType.UnpaidLeave]: {
        used: calendarDaysIn(requests, VacationType.UnpaidLeave, year),
      },
      [VacationType.Other]: {
        used: calendarDaysIn(requests, VacationType.Other, year),
      },
    },
  };
};

// The days whose requests leaveBalanceOf needs: from the year the carryover
// starts in to the end of the year asked. Whatever the policy, so that the
// requests can be read beside it.
export const requestWindowOf = (
  input: Omit<ILeaveBalanceInput, 'requests'>,
): { from: Date; to: Date } => {
  const year = yearOf(input.contractStartDate, input.date);

  return {
    from: (chainStartOf(input, year)?.year ?? year).periodStart,
    to: year.periodEnd,
  };
};

// What Logbook counts on `on` without a file balance: what is left before
// any leave from `on` on, and that leave (to the end of its vacation year)
// with what it takes. Null without a policy.
export const countedOn = (
  input: Omit<ILeaveBalanceInput, 'fileBalance' | 'date'>,
  on: string,
): { left: ILeft; usedFrom: ILeft; planned: ICountedRequest[] } | null => {
  const { policy, requests } = input;

  if (!policy) {
    return null;
  }

  const year = yearOf(input.contractStartDate, on);
  const allowance = allowanceOf(policy);
  const { carry } = carriedInto(
    { ...input, fileBalance: null, date: new Date(on) },
    policy,
    year,
  );
  const before = takenIn(requests, year.start, dayBefore(on));

  return {
    left: {
      days: allowance.days + carry.days - before.days,
      workingDays:
        allowance.workingDays + carry.workingDays - before.workingDays,
      bonusDays: allowance.bonusDays - before.bonusDays,
    },
    usedFrom: takenIn(requests, on, year.end),
    planned: requests
      .filter(
        (request) =>
          TAKES_FROM_BALANCE.has(request.type) &&
          request.endDate >= on &&
          request.startDate <= year.end,
      )
      .sort((a, b) => a.startDate.localeCompare(b.startDate)),
  };
};

// The same balance on `on`, a day of its vacation year: what was left on its
// own day less the leave from that day to `on`, or plus the leave from `on`
// to that day when `on` is earlier. Each unit counts its own way, so a unit
// the file left empty stays empty.
export const balanceMovedTo = (
  balance: IFileBalance,
  on: string,
  requests: ICountedRequest[],
): IFileBalance => {
  const later = on > balance.balanceOn;
  const between = later
    ? takenIn(requests, balance.balanceOn, dayBefore(on))
    : takenIn(requests, on, dayBefore(balance.balanceOn));
  const moved = (left: number | null, taken: number) =>
    left === null ? null : later ? left - taken : left + taken;

  return {
    balanceOn: on,
    daysLeft: moved(balance.daysLeft, between.days),
    workingDaysLeft: moved(balance.workingDaysLeft, between.workingDays),
    bonusDaysLeft: moved(balance.bonusDaysLeft, between.bonusDays),
  };
};

const TAKES_FROM_BALANCE = new Set([
  VacationType.AnnualLeave,
  VacationType.BonusDay,
]);

// The year the carryover into `year` starts in: the one the person joined
// in, with what HR entered on the profile, or the one of a file balance
// before it, which carries what it says was left. None for a year still to
// come, or one before where it would start.
const chainStartOf = (
  input: Omit<ILeaveBalanceInput, 'requests' | 'policy'>,
  year: IYear,
): { year: IYear; joined: boolean } | null => {
  if (year.start > getDateOnly(input.today)) {
    return null;
  }

  const joined = toYear(
    getJoinedVacationPeriod(
      input.contractStartDate,
      input.createdAt,
      input.today,
    ),
  );
  const balance =
    input.fileBalance &&
    yearOf(input.contractStartDate, input.fileBalance.balanceOn);
  const start =
    balance && balance.start <= year.start && balance.start < joined.start
      ? { year: balance, joined: false }
      : { year: joined, joined: true };

  return start.year.start <= year.start ? start : null;
};

// The carryover into `year`, year by year from where it starts, calendar and
// working days apart; and the file balance's correction when `year` holds
// its date.
const carriedInto = (
  input: Omit<ILeaveBalanceInput, 'policy'>,
  policy: IVacationPolicyViewModel,
  year: IYear,
): ICarried => {
  const start = chainStartOf(input, year);

  if (!start) {
    return NOTHING_CARRIED;
  }

  const { contractStartDate, fileBalance, requests } = input;
  const allowance = allowanceOf(policy);
  const most = policy.carryover_days || 0;
  const entered = start.joined ? Math.min(input.carryoverDays ?? 0, most) : 0;
  const balanceYear =
    fileBalance && yearOf(contractStartDate, fileBalance.balanceOn);
  let carry = { days: entered, workingDays: entered };

  for (const period of getVacationPeriodsBetween(
    contractStartDate,
    start.year.periodStart,
    year.periodStart,
  )) {
    const current = toYear(period);
    const correction =
      fileBalance && current.start === balanceYear!.start
        ? correctionIn(current, fileBalance, allowance, carry, requests)
        : null;

    if (current.start === year.start) {
      return { carry, correction };
    }

    const taken = takenIn(requests, current.start, current.end);

    carry = {
      days: clamp(
        allowance.days + carry.days + (correction?.days ?? 0) - taken.days,
        most,
      ),
      workingDays: clamp(
        allowance.workingDays +
          carry.workingDays +
          (correction?.workingDays ?? 0) -
          taken.workingDays,
        most,
      ),
    };
  }

  return NOTHING_CARRIED;
};

// The file's balance minus what Logbook counts left before its day, per unit
// the file gives.
const correctionIn = (
  year: IYear,
  fileBalance: IFileBalance,
  allowance: ILeft,
  carry: ICarried['carry'],
  requests: ICountedRequest[],
): Correction => {
  const before = takenIn(
    requests,
    year.start,
    dayBefore(fileBalance.balanceOn),
  );
  const difference = (left: number | null, counted: number) =>
    left === null ? null : left - counted;

  return {
    balanceOn: fileBalance.balanceOn,
    days: difference(
      fileBalance.daysLeft,
      allowance.days + carry.days - before.days,
    ),
    workingDays: difference(
      fileBalance.workingDaysLeft,
      allowance.workingDays + carry.workingDays - before.workingDays,
    ),
    bonusDays: difference(
      fileBalance.bonusDaysLeft,
      allowance.bonusDays - before.bonusDays,
    ),
  };
};

const limitsOf = (
  policy: IVacationPolicyViewModel,
  { carry, correction }: ICarried,
): IVacationLimits => {
  const allowance = allowanceOf(policy);

  return {
    vacationDays: allowance.days,
    workingDays: allowance.workingDays,
    bonusDays: allowance.bonusDays,
    carryoverDays: carry.days,
    carryoverWorkingDays: carry.workingDays,
    daysTotal: allowance.days + carry.days + (correction?.days ?? 0),
    correction,
  };
};

const allowanceOf = (policy: IVacationPolicyViewModel): ILeft => ({
  days: policy.vacation_days || 0,
  workingDays: policy.working_days || 0,
  bonusDays: policy.bonus_days || 0,
});

// The leave from `from` to `to` (both included) that takes from a balance.
// Bonus days count in working days: a Friday to Monday request takes 2.
const takenIn = (
  requests: ICountedRequest[],
  from: string,
  to: string,
): ILeft =>
  requests.reduce<ILeft>(
    (taken, request) => {
      if (request.type === VacationType.AnnualLeave) {
        const { days, workingDays } = daysIn(request, from, to);

        taken.days += days;
        taken.workingDays += workingDays;
      } else if (request.type === VacationType.BonusDay) {
        taken.bonusDays += daysIn(request, from, to).workingDays;
      }

      return taken;
    },
    { days: 0, workingDays: 0, bonusDays: 0 },
  );

const calendarDaysIn = (
  requests: ICountedRequest[],
  type: VacationType,
  year: IYear,
) =>
  requests
    .filter((request) => request.type === type)
    .reduce(
      (sum, request) => sum + daysIn(request, year.start, year.end).days,
      0,
    );

// A request counts with its days from `from` to `to` only.
const daysIn = (request: ICountedRequest, from: string, to: string) => {
  const start = request.startDate > from ? request.startDate : from;
  const end = request.endDate < to ? request.endDate : to;

  if (start > end) {
    return { days: 0, workingDays: 0 };
  }

  return {
    days: getDaysBetweenDates(new Date(start), new Date(end)),
    workingDays: request.workingDates.filter(
      (date) => date >= start && date <= end,
    ).length,
  };
};

const yearOf = (contractStartDate: string | null, date: Date | string) =>
  toYear(getCurrentVacationPeriod(contractStartDate, new Date(date)));

const toYear = ({
  periodStart,
  periodEnd,
}: {
  periodStart: Date;
  periodEnd: Date;
}): IYear => ({
  periodStart,
  periodEnd,
  start: getDateOnly(periodStart),
  end: getDateOnly(periodEnd),
});

const dayBefore = (date: string) =>
  getDateOnly(new Date(new Date(date).getTime() - DAY_MS));

const clamp = (days: number, most: number) => Math.max(0, Math.min(days, most));
