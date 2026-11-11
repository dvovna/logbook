import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';

export interface ITimeEntryCreateParams {
  userId: string;
  // The team of the user the time is logged for.
  teamId: string | null;
  projectId: string;
  workDate: Date;
  minutes: number;
  description?: string | null;
  status: TimeEntryStatus;
}

export interface ITimeEntryUpdateParams {
  userId?: string;
  teamId?: string | null;
  projectId?: string;
  workDate?: Date;
  minutes?: number;
  description?: string | null;
  status?: TimeEntryStatus;
}

// What an entry takes from its project.
export interface ITimeEntryProject {
  id: string;
  client_id: string | null;
  billable: boolean;
}

export interface ITimeEntryInsert {
  params: ITimeEntryCreateParams;
  project: ITimeEntryProject;
  // The vacation the time was logged from.
  vacationRequestId?: string;
}

export type ITimeEntryActor = Pick<IUserViewModel, 'id' | 'slack_team_id'>;

export interface ITimeEntryWriteOptions {
  // Write only while the entry is a draft or rejected: the owner's rule, and
  // the timesheet's for everyone. Admin and HR otherwise change any entry.
  openOnly?: boolean;
}

export interface ITimeEntryUpdateWriteOptions extends ITimeEntryWriteOptions {
  // The new project, when the changes move the entry to one.
  project?: ITimeEntryProject;
}
