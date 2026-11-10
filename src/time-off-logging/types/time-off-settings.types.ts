import VacationType from '@common/enums/vacation-type.enum';

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
