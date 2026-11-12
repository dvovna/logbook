import VacationType from '@common/enums/vacation-type.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  ICountedRequest,
  IFileBalance,
  ILeft,
} from '@modules/vacation-requests/utils/leave-balance.utils';

export interface ILeaveBalancesState {
  // YYYY-MM-DD.
  today: string;
  // Inactive people included.
  people: IUserViewModel[];
  // By user id; null or missing for a person who follows no policy.
  policyOf: Map<string, IVacationPolicyViewModel | null>;
  requestsOf: Map<string, ICountedRequest[]>;
  // The balances an earlier file set, by user id.
  balanceOf: Map<string, IFileBalance>;
}

export interface ILeaveBalancesPlan {
  balances: {
    userId: string;
    balanceOn: string;
    daysLeft: number | null;
    workingDaysLeft: number | null;
    bonusDaysLeft: number | null;
    // What Logbook counts left on `balanceOn`, for HR to compare.
    counted: ILeft;
    // Leave from `balanceOn` to the end of its year that takes from a balance.
    planned: { type: VacationType; startDate: string; endDate: string }[];
    // The balance after that leave, per unit the row gives.
    after: {
      days: number | null;
      workingDays: number | null;
      bonusDays: number | null;
    };
  }[];
  contractStarts: { userId: string; before: string | null; after: string }[];
  unchanged: number;
  unusable: { row: number; reason: string }[];
}
