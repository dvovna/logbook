import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamModalViewService } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { IEditUserModalViewMetadata } from 'src/slack/services/slack-views/modal-views/edit-user-modal-view.service';
import { UsersService } from 'src/users/users.service';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/services/users-tab.service';
import EditUserModalViewValuesParser from 'src/slack/services/slack-views/parsers/edit-user-modal-view-values.parser';
import { IUsersTabMetaData } from 'src/slack/services/slack-views/tab-views/users-tab-view.service';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UserFormSubmit,
  type: 'view_submission',
})
export class EditUserFormSubmitHandler {
  private readonly logger = new Logger(EditUserFormSubmitHandler.name);

  public constructor(
    private readonly userModalViewValuesParser: EditUserModalViewValuesParser,
    private readonly teamModalViewService: TeamModalViewService,
    private readonly usersService: UsersService,
    private readonly usersTabService: UsersTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IEditUserModalViewMetadata>(payload);
    const { view } = payload;
    const { userIdToEdit } = metadata;
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IUsersTabMetaData)
      : {};

    const { data, errors } = this.userModalViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const updatedUser = await this.usersService.update(
        { id: userIdToEdit, slackTeamId: user.slack_team_id },
        {
          role: data.role,
          teamId: data.team_id,
          carryoverDays: data.carryover_days,
          updatedBy: user.id,
        },
      );

      this.usersTabService.publish({ user, page: 1, metadata: pageMetadata });

      if (!updatedUser) {
        return SlackViewResponseFactory.update(
          await this.usersTabService.getModalView(UsersTabModalName.EditUser, {
            user,
            errorMessage: 'User not found',
            userId: userIdToEdit,
            pageMetadata: metadata.pageMetadata,
          }),
        );
      }

      return SlackViewResponseFactory.update(
        this.teamModalViewService.getSuccessView(
          `✅ User '${updatedUser.name}' was updated successfully!`,
        ),
      );
    } catch (error) {
      this.logger.error(`error`, error);

      return SlackViewResponseFactory.update(
        await this.usersTabService.getModalView(UsersTabModalName.EditUser, {
          user,
          errorMessage:
            'An error occurred while updating the user. Please try again later.',
          userId: userIdToEdit,
          pageMetadata: metadata.pageMetadata,
        }),
      );
    }
  }
}
