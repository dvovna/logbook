import VacationType from 'src/common/enums/vacation-type.enum';

const VACATION_TYPE_EMOJI: Record<VacationType, string> = {
  [VacationType.AnnualLeave]: '🏖️',
  [VacationType.BonusDay]: '🎁',
  [VacationType.SickLeave]: '🤒',
  [VacationType.UnpaidLeave]: '💸',
  [VacationType.Other]: '📌',
};

export const getVacationTypeIcon = (type: VacationType) => {
  return VACATION_TYPE_EMOJI[type] || '📌';
};
