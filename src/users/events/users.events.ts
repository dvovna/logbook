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

// A person was deactivated or their role changed, by whatever route: their
// open approval steps may need someone else.
export class UserAccessChangedEvent {
  public constructor(
    public readonly userId: string,
    public readonly slackTeamId: string,
  ) {}
}
