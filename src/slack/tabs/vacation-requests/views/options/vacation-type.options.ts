import VacationType from '@common/enums/vacation-type.enum';
import { IOption } from '@modules/slack/common/types/option.interface';

export const VACATION_TYPE_OPTIONS: IOption[] = [
  {
    name: 'Annual Leave',
    id: VacationType.AnnualLeave,
  },
  {
    name: 'Bonus Day',
    id: VacationType.BonusDay,
  },
  {
    name: 'Sick Leave',
    id: VacationType.SickLeave,
  },
  {
    name: 'Unpaid Leave',
    id: VacationType.UnpaidLeave,
  },
  {
    name: 'Other',
    id: VacationType.Other,
  },
];
