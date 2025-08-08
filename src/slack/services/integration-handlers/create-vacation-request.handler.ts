import { Injectable } from '@nestjs/common';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import { VacationsService } from 'src/vacations/vacations.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export class CreateVacationRequestHandler {
  public constructor(
    private readonly vacationsService: VacationsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    metadata: IViewMetadata,
    user: IUserViewModel,
  ) {
    const { view } = payload;
    const { userId, teamId } = metadata;

    const { startDate, endDate, type, comment } =
      this.vacationRequestViewService.extractData(view.state.values);

    await this.vacationsService.create(
      {
        userId,
        teamId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        type: type as VacationType,
        status: VacationStatus.Requested,
        comment,
      },
      user,
    );

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      { text: 'Vacation request created successfully!' },
      teamId,
    );
  }
}
