import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

export interface IVacationViewModel {
  id: string;
  startDate: string;
  endDate: string;
  days: number;
  type: VacationType;
  status: VacationStatus;
  userId: string;
  createdAt: string | null;
  updatedAt: string | null;
  approvedByHr: boolean | null;
  approvedByManager: boolean | null;
  updatedBy: string | null;
  createdBy: string | null;
}
