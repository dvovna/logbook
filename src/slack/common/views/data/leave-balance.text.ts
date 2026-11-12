import { formatDate } from '@common/utils/date.utils';
import { IVacationLimits } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import pluralize from 'pluralize';

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

type Correction = NonNullable<IVacationLimits['correction']>;

// What a balance from a file changed, in the units it changed: "*-4*
// correction". A unit the file left empty, or gave as Logbook counted it,
// has none.
export const correctionDetails = (
  correction: Correction | null | undefined,
  units: { days?: boolean; workingDays?: boolean; bonusDays?: boolean },
): string[] => {
  if (!correction) {
    return [];
  }

  return [
    units.days && correction.days
      ? `*${signed(correction.days)}* correction`
      : null,
    units.workingDays && correction.workingDays
      ? `*${signed(correction.workingDays)}* working correction`
      : null,
    units.bonusDays && correction.bonusDays
      ? `*${signed(correction.bonusDays)}* correction`
      : null,
  ].filter((detail): detail is string => detail !== null);
};

// "Set from a file: 12 days, 7 working days, 2 bonus days left on ...": what
// HR gave, only the units the file had.
export const fileBalanceLine = (balance: ILeaveBalance): string => {
  const given = [
    balance.days_left !== null && pluralize('day', balance.days_left, true),
    balance.working_days_left !== null &&
      `${pluralize('working day', balance.working_days_left, true)}`,
    balance.bonus_days_left !== null &&
      `${pluralize('bonus day', balance.bonus_days_left, true)}`,
  ].filter(Boolean);

  return `Set from a file: ${given.join(', ')} left on ${formatDate(balance.balance_on)}.`;
};
