export interface IProjectUserRateViewModel {
  slack_team_id: string;
  project_id: string;
  user_id: string;
  hourly_rate: number;
  user: { id: string; name: string } | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

// A person's own rate on a project, which replaces the project's rate.
export interface IPersonRate {
  userId: string;
  name: string;
  hourlyRate: number;
}

// A project's rate and the people's own rates on it, by name.
export interface IProjectRates {
  hourlyRate: number | null;
  personRates: IPersonRate[];
}
