import { IUserViewModel } from '@modules/users/types/user.interface';

// Where an imported leave came from.
export interface ILeaveFileImport {
  fileName: string;
  // Null when that person is gone.
  appliedBy: IUserViewModel | null;
  appliedAt: string;
}
