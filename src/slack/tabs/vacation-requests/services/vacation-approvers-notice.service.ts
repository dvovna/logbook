import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestWithoutTeamApproversEvent } from '@modules/vacation-requests/events/vacation-request.events';

// Tells the requester who decides a request nobody on their team can approve:
// HR, the admins, or nobody yet.
@Injectable()
export class VacationApproversNoticeService {
  public constructor(
    private readonly communicationService: SlackCommunicationService,
  ) {}

  @OnEvent(VacationRequestEvent.WithoutTeamApprovers)
  public async handleWithoutTeamApprovers({
    request,
    inTeam,
    sentTo,
  }: VacationRequestWithoutTeamApproversEvent) {
    await this.communicationService.postMessage(
      request.user!.slack_id,
      { text: this.getText(request, inTeam, sentTo) },
      request.slack_team_id,
    );
  }

  private getText(
    request: VacationRequestWithoutTeamApproversEvent['request'],
    inTeam: boolean,
    sentTo: VacationRequestWithoutTeamApproversEvent['sentTo'],
  ) {
    const dates = formatDateRange(request.start_date, request.end_date);
    const reason = inTeam
      ? 'your team has no other approvers'
      : 'you are not in a team';

    if (sentTo === UserRole.HR) {
      return `📨 Your vacation request (${dates}) went to HR for approval: ${reason}.`;
    }

    if (sentTo === UserRole.Admin) {
      return `📨 Your vacation request (${dates}) went to the workspace admins for approval: ${reason}.`;
    }

    return `⚠️ Nobody can approve your vacation request (${dates}) yet: ${reason}, and nobody else has the HR or Admin role. It stays pending until an admin adds approvers to your team.`;
  }
}
