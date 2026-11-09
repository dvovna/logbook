interface ISlackTeamViewModel {
  id: string;
  name: string;
  slack_id: string;
  created_at: string | null;
  // Set while the app is uninstalled: the data waits for a reinstall.
  uninstalled_at: string | null;
}

export default ISlackTeamViewModel;
