import VacationType from '@common/enums/vacation-type.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  ICountedRequest,
  IFileBalance,
  ILeft,
} from '@modules/vacation-requests/utils/leave-balance.utils';

export interface ILeaveHistoryState {
  // YYYY-MM-DD.
  today: string;
  // Inactive people included.
  people: IUserViewModel[];
  // By user id; null or missing for a person who follows no policy.
  policyOf: Map<string, IVacationPolicyViewModel | null>;
  // Approved and pending requests by user id.
  requestsOf: Map<string, ICountedRequest[]>;
  // The balances a file set, by user id.
  balanceOf: Map<string, IFileBalance>;
  workingDatesOf: (
    userId: string,
    startDate: string,
    endDate: string,
  ) => string[];
}

export interface ILeaveHistoryPlan {
  add: {
    row: number;
    userId: string;
    type: VacationType;
    startDate: string;
    endDate: string;
    comment: string | null;
  }[];
  // Rows already in Logbook as an approved or pending request.
  skipped: number;
  // People with no file balance whose availability today the added rows change.
  balanceChanges: { userId: string; before: ILeft; after: ILeft }[];
  // For people with a file balance: the added leave from its date, with
  // what the file said was left (`left`) and what all leave from its date
  // leaves of it (`after`), per unit the file gave.
  plannedLeave: {
    userId: string;
    balanceOn: string;
    leave: { type: VacationType; startDate: string; endDate: string }[];
    left: {
      days: number | null;
      workingDays: number | null;
      bonusDays: number | null;
    };
    after: {
      days: number | null;
      workingDays: number | null;
      bonusDays: number | null;
    };
  }[];
  unusable: { row: number; reason: string }[];
}
