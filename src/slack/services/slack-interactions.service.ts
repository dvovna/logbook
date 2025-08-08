import { Injectable, Logger } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { SubmitTeamSettingsHandler } from 'src/slack/services/integration-handlers/submit-team-settings.handler';
import { CreateVacationRequestHandler } from 'src/slack/services/integration-handlers/create-vacation-request.handler';
import HomeTabActionsHandler from 'src/slack/services/integration-handlers/home-tab-actions.handler';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export default class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly submitTeamSettingsHandler: SubmitTeamSettingsHandler,
    private readonly createVacationRequestHandler: CreateVacationRequestHandler,
    private readonly homeTabActionsHandler: HomeTabActionsHandler,
  ) {}

  public async handleSlackInteraction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    switch (payload.type) {
      case 'view_submission': {
        await this.handleViewSubmission(payload, user);

        break;
      }
      case 'block_actions': {
        await this.handleBlockActions(payload, user);

        break;
      }
      default: {
        this.logger.warn(`Unhandled interaction type: ${payload.type}`);

        break;
      }
    }
  }

  private async handleBlockActions(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const { callback_id } = payload.view;

    switch (callback_id) {
      case ViewCallbackId.HomeTab: {
        await this.homeTabActionsHandler.handle(payload, user);

        break;
      }
      default: {
        this.logger.warn(`Unhandled block action callback_id: ${callback_id}`);
      }
    }
  }

  private async handleViewSubmission(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const { callback_id } = payload.view;
    const metadata = JSON.parse(payload.view.private_metadata) as IViewMetadata;

    switch (callback_id) {
      case ViewCallbackId.ChangeTeamSettings: {
        await this.submitTeamSettingsHandler.handle(payload, metadata, user);

        break;
      }
      case ViewCallbackId.CreateVacationRequest: {
        await this.createVacationRequestHandler.handle(payload, metadata, user);

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
