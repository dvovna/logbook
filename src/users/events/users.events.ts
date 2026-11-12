export const USER_TEAM_CHANGED = 'users.team_changed';

// A person moved to another team or out of any team, by whatever route: the
// team form, People, the team file or a prompt.
export class UserTeamChangedEvent {
  public constructor(
    public readonly userId: string,
    public readonly slackTeamId: string,
    // null: the person is in no team now.
    public readonly teamId: string | null,
    // Who moved them, when a user did.
    public readonly changedBy: string | null,
  ) {}
}

export const USER_ACCESS_CHANGED = 'users.access_changed';

// A person was deactivated or left without a role that approves, by whatever
// route: their open approval steps may need someone else.
export class UserAccessChangedEvent {
  public constructor(
    public readonly userId: string,
    public readonly slackTeamId: string,
  ) {}
}

export const APPROVERS_CHANGED = 'users.approvers_changed';

// Someone may decide time off who couldn't before: a person got a role that
// approves or was made active again, or a team's approvers or the company
// rules changed. Published in the change's transaction (emitAsync), so that
// the requests that waited for anyone who can approve them get their
// approval with it.
export class ApproversChangedEvent {
  public constructor(public readonly slackTeamId: string) {}
}
