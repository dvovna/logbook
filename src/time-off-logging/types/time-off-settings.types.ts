import VacationType from '@common/enums/vacation-type.enum';
import { TimeOffLeaveType } from 'src/time-off-logging/constants/time-off-leave-types';

export interface ITimeOffSettings {
  // The hours of a working day, in minutes.
  minutesPerDay: number;
  // The project each leave type is logged on; a type without one is not.
  projectIds: Partial<Record<VacationType, string>>;
}

export interface ITimeOffProjectViewModel {
  slack_team_id: string;
  vacation_type: string;
  project_id: string;
}

// What time off is logged as, as people read it: the hours of a day, and the
// leave types that have an active project, in the order of
// TIME_OFF_LEAVE_TYPES.
export interface ITimeOffSetup {
  minutesPerDay: number;
  projects: { type: TimeOffLeaveType; projectName: string }[];
}
