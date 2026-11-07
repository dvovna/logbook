// The parts of a Slack request body that name the workspace.
export interface ISlackRequestWorkspace {
  team_id?: string;
  team?: { id?: string };
  user?: { team_id?: string };
}

// The Slack workspace (`T…`) a request comes from. Events and slash commands
// carry it as `team_id`; interaction and options payloads as `team.id`.
export const getRequestWorkspaceSlackId = (
  body: ISlackRequestWorkspace | undefined,
): string | undefined => body?.team_id || body?.team?.id || body?.user?.team_id;
