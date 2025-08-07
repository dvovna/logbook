import { Injectable, Logger } from '@nestjs/common';
import { IntegrationCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { SubmitTeamSettingsHandler } from 'src/slack/services/integration-handlers/submit-team-settings.handler';
import { CreateVacationRequestHandler } from 'src/slack/services/integration-handlers/create-vacation-request.handler';
import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';

export interface ISlackInteractionPayload {
  type: string;
  view: {
    team_id: string;
    callback_id: IntegrationCallbackId;
    private_metadata: string;
    state: {
      values: IViewStateValues;
    };
  };
  user: {
    id: string;
  };
}

@Injectable()
export default class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly submitTeamSettingsHandler: SubmitTeamSettingsHandler,
    private readonly createVacationRequestHandler: CreateVacationRequestHandler,
  ) {}

  public async handleSlackInteraction(payload: ISlackInteractionPayload) {
    switch (payload.type) {
      case 'view_submission': {
        await this.handleViewSubmission(payload);

        break;
      }
      default: {
        this.logger.warn(`Unhandled interaction type: ${payload.type}`);

        break;
      }
    }
  }

  private async handleViewSubmission(payload: ISlackInteractionPayload) {
    const { callback_id } = payload.view;
    const metadata = JSON.parse(payload.view.private_metadata) as IViewMetadata;

    switch (callback_id) {
      case IntegrationCallbackId.ChangeTeamSettings: {
        await this.submitTeamSettingsHandler.handle(payload, metadata);

        break;
      }
      case IntegrationCallbackId.CreateVacationRequest: {
        await this.createVacationRequestHandler.handle(payload, metadata);

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled view submission callback_id: ${callback_id}`,
        );
      }
    }
  }
}
