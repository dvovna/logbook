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
import { ITeamModalViewMetadata } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import { DeleteTeamFormSubmitHandler } from 'src/slack/services/integration-handlers/delete-team-form-submit.handler';
import { IDeleteTeamModalViewMetadata } from 'src/slack/services/slack-views/modal-views/delete-team-modal-view.service';
import UserActionsHandler from 'src/slack/services/integration-handlers/user-actions.handler';
import { IEditUserModalViewMetadata } from 'src/slack/services/slack-views/modal-views/edit-user-modal-view.service';
import { EditUserFormSubmitHandler } from 'src/slack/services/integration-handlers/edit-user-form-submit.handler';
import { IChangeUserStatusModalViewMetadata } from 'src/slack/services/slack-views/modal-views/change-user_status-modal-view.service';
import { ChangeUserStatusFormSubmitHandler } from 'src/slack/services/integration-handlers/change-user-status-form-submit.handler';

@Injectable()
export default class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly createVacationRequestHandler: CreateVacationRequestHandler,
    private readonly homeTabActionsHandler: HomeTabActionsHandler,
    private readonly teamActionsHandler: TeamActionsHandler,
    private readonly userActionsHandler: UserActionsHandler,
    private readonly deleteTeamFormSubmitHandler: DeleteTeamFormSubmitHandler,
    private readonly changeUserStatusFormSubmitHandler: ChangeUserStatusFormSubmitHandler,
    private readonly teamFormSubmitHandler: TeamFormSubmitHandler,
    private readonly editUserFormSubmitHandler: EditUserFormSubmitHandler,
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
      case ViewCallbackId.TeamTabView: {
        return this.teamActionsHandler.handle(payload, user);
      }
      case ViewCallbackId.UserTabView: {
        return this.userActionsHandler.handle(payload, user);
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
      case ViewCallbackId.TeamModalView: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as ITeamModalViewMetadata;

        return this.teamFormSubmitHandler.handle(payload, metadata, user);
      }
      case ViewCallbackId.EditUserModalView: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as IEditUserModalViewMetadata;

        return this.editUserFormSubmitHandler.handle(payload, metadata, user);
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
      case ViewCallbackId.ChangeUserStatus: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as IChangeUserStatusModalViewMetadata;

        return this.changeUserStatusFormSubmitHandler.handle(
          payload,
          metadata,
          user,
        );
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
