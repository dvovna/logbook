import { Injectable, Logger } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { CreateVacationRequestHandler } from 'src/slack/services/integration-handlers/create-vacation-request.handler';
import HomeTabActionsHandler from 'src/slack/services/integration-handlers/home-tab-actions.handler';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamActionsHandler from 'src/slack/services/integration-handlers/team-actions.handler';
import { TeamFormSubmitHandler } from 'src/slack/services/integration-handlers/team-form-submit.handler';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { IGetTeamModalViewMetadata } from 'src/slack/services/slack-views/team-modal-view.service';
import { DeleteTeamFormSubmitHandler } from 'src/slack/services/integration-handlers/delete-team-form-submit.handler';
import { IDeleteTeamModalViewMetadata } from 'src/slack/services/slack-views/delete-team-modal-view.service';

@Injectable()
export default class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly createVacationRequestHandler: CreateVacationRequestHandler,
    private readonly homeTabActionsHandler: HomeTabActionsHandler,
    private readonly teamActionsHandler: TeamActionsHandler,
    private readonly deleteTeamFormSubmitHandler: DeleteTeamFormSubmitHandler,
    private readonly manageTeamFormSubmitHandler: TeamFormSubmitHandler,
  ) {}

  public async handleSlackInteraction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction | void> {
    switch (payload.type) {
      case 'view_submission': {
        return this.handleViewSubmission(payload, user);
      }
      case 'block_actions': {
        return this.handleBlockActions(payload, user);
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
        return this.homeTabActionsHandler.handle(payload, user);
      }
      case ViewCallbackId.TeamManagement: {
        return this.teamActionsHandler.handle(payload, user);
      }
      default: {
        this.logger.warn(`Unhandled block action callback_id: ${callback_id}`);
      }
    }
  }

  private async handleViewSubmission(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const { callback_id } = payload.view;

    switch (callback_id) {
      case ViewCallbackId.TeamManagement: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as IGetTeamModalViewMetadata;

        return this.manageTeamFormSubmitHandler.handle(payload, metadata, user);
      }
      case ViewCallbackId.CreateVacationRequest: {
        return this.createVacationRequestHandler.handle(payload, user);
      }
      case ViewCallbackId.DeleteTeam: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as IDeleteTeamModalViewMetadata;

        return this.deleteTeamFormSubmitHandler.handle(payload, metadata, user);
      }
      default: {
        this.logger.warn(
          `Unhandled view submission callback_id: ${callback_id}`,
        );
      }
    }

    return SlackViewResponseFactory.success();
  }
}
