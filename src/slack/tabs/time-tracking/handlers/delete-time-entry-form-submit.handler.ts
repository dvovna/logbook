import { ALL_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// The confirmation behind "Delete" in the time entries tab. The entry is
// only marked as deleted.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteTimeEntry,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class DeleteTimeEntryFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  ITimeEntryViewModel
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.timeEntriesService.delete(
      { id: meta.id, slackTeamId: user.slack_team_id },
      user,
    );
  }

  protected successResponse(
    _entry: ITimeEntryViewModel,
    user: IUserViewModel,
    meta: IConfirmationModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.TimeEntries, {
      user,
      metadata: meta.pageMetadata
        ? (JSON.parse(meta.pageMetadata) as ITimeEntriesTabMetaData)
        : { ownEntriesOnly: true },
      notice: '✅ Time entry deleted.',
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeEntriesTabService.getModalView(
        TimeEntriesTabModalName.DeleteEntry,
        {
          entryId: meta.id,
          user,
          errorMessage,
          pageMetadata: meta.pageMetadata ?? '',
        },
      ),
    );
  }
}
