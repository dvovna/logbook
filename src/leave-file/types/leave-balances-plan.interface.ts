import VacationType from '@common/enums/vacation-type.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import {
  ICountedRequest,
  IFileBalance,
  ILeft,
  IStoredBalance,
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

// The state read from the workspace: each earlier balance as stored, which
// Apply keeps for Undo to put back whole.
export interface IStoredLeaveBalancesState extends ILeaveBalancesState {
  balanceOf: Map<string, IStoredBalance>;
}

export interface ILeaveBalancesPlan {
  balances: {
    userId: string;
    balanceOn: string;
    // What the row gives, and where it leaves a cell empty, the earlier
    // balance's count of the same vacation year moved to `balanceOn`.
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
    // The units of the person's earlier balance, of another vacation year,
    // that the row leaves empty: they go with it. Missing when none does.
    dropped?: {
      balanceOn: string;
      days: number | null;
      workingDays: number | null;
      bonusDays: number | null;
    };
  }[];
  contractStarts: {
    userId: string;
    before: string | null;
    after: string;
    // The date of the person's earlier file balance, which the file keeps,
    // when the new contract start moves it out of the current vacation year
    // into the one before (where it carries over).
    movedBalanceOn?: string;
  }[];
  unchanged: number;
  unusable: { row: number; reason: string }[];
}
