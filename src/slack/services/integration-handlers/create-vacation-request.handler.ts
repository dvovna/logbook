import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { ISlackInteractionPayload } from 'src/slack/services/slack-interactions.service';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import { VacationsService } from 'src/vacations/vacations.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';

@Injectable()
export class CreateVacationRequestHandler {
  public constructor(
    private readonly usersService: UsersService,
    private readonly vacationsService: VacationsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    metadata: IViewMetadata,
  ) {
    const { user, view } = payload;
    const { userId, teamId } = metadata;

    const userData = await this.usersService.findOneWithValidation({
      id: userId,
      teamId,
    });

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
      userData,
    );

    await this.slackCommunicationService.postMessage(
      user.id,
      { text: 'Vacation request created successfully!' },
      teamId,
    );
  }
}
