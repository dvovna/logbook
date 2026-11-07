import { HttpException, HttpStatus } from '@nestjs/common';

export type SlackUserAccess = 'unknown' | 'inactive';

// Someone Logbook doesn't know in the workspace (not synced yet, or the app
// isn't installed there), or a deactivated user. The Slack routes answer it
// with a short message instead of an HTTP error, which Slack would only show
// as "failed with the error http_service_error" (SlackUserAccessFilter).
export class SlackUserAccessException extends HttpException {
  public constructor(
    public readonly access: SlackUserAccess,
    public readonly slackUserId: string,
    // The workspace's internal ID, when the workspace is known.
    public readonly slackTeamId?: string,
  ) {
    super(
      access === 'unknown' ? 'User not found.' : 'User is inactive.',
      access === 'unknown' ? HttpStatus.UNAUTHORIZED : HttpStatus.FORBIDDEN,
    );
  }
}
