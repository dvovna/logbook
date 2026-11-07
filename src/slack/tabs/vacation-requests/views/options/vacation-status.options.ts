import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IOption } from '@common/types/option.interface';

export const STATUS_OPTIONS: IOption[] = [
  {
    name: 'Approved ✅',
    id: VacationRequestStatus.Approved,
  },
  {
    name: 'Pending ⏳',
    id: VacationRequestStatus.Pending,
  },
  {
    name: 'Rejected ❌',
    id: VacationRequestStatus.Rejected,
  },
  {
    name: 'Canceled 🛑',
    id: VacationRequestStatus.Canceled,
  },
];
