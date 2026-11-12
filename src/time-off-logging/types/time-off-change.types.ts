import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

export interface IVacationRequestChange {
  request: IVacationRequestViewModel;
  // The days whose logged time stays, sorted: it is in a billing snapshot.
  billedDates: string[];
}
