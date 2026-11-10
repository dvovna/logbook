interface ISlackTeamViewModel {
  id: string;
  name: string;
  slack_id: string;
  created_at: string | null;
  // ISO 4217 code of the currency that rates and amounts are in.
  currency: string;
  // Minutes of a working day, which a day of time off is logged as.
  time_off_minutes_per_day: number;
  // Set while the app is uninstalled: the data waits for a reinstall.
  uninstalled_at: string | null;
}

export default ISlackTeamViewModel;
