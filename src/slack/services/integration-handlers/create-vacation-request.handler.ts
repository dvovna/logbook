import { Injectable } from '@nestjs/common';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { VacationsService } from 'src/vacations/vacations.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import VacationRequestViewValuesParser
  from 'src/slack/services/slack-views/parsers/vacation-request-view-values.parser';

@Injectable()
export class CreateVacationRequestHandler {
  public constructor(
    private readonly vacationsService: VacationsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewValuesParser: VacationRequestViewValuesParser,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const { view } = payload;

    const { data, errors } = this.vacationRequestViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    await this.vacationsService.create(
      {
        userId: user.id,
        teamId: user.team_id,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        type: data.type,
        status: VacationStatus.Requested,
        comment: data.comment,
      },
      user,
    );

    await this.slackCommunicationService.postEphemeral(
      user.slack_id,
      {
        text: `Vacation request has been successfully created!`,
      },
      user.slack_team_id,
    );

    return SlackViewResponseFactory.success();
  }
}
