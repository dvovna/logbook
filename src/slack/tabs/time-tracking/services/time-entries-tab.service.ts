import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import {
  ITimeEntriesTabMetaData,
  TimeEntriesTabView,
} from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { TimeEntriesTabDataService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab-data.service';
import { View } from '@slack/types/dist/views';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';
import UserRole from '@common/enums/user-role.enum';

interface ITimeEntryModalViewParams extends IOpenModalBaseParams<string> {
  entryId: string;
}

type TimeEntriesTabModalViewResolversMap = {
  [TimeEntriesTabModalName.CreateTimeEntry]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
  [TimeEntriesTabModalName.UpdateTimeEntry]: (
    params: ITimeEntryModalViewParams,
  ) => Promise<View>;
  [TimeEntriesTabModalName.DeleteEntry]: (
    params: ITimeEntryModalViewParams,
  ) => Promise<View>;
};

// Who may see (and edit) everyone's entries; everyone else sees their own.
const ALL_ENTRIES_ROLES = [UserRole.Admin, UserRole.HR];

interface IGetTimeEntriesTabViewParams extends IPublishBaseParams {
  metadata?: ITimeEntriesTabMetaData;
}

@Injectable()
export class TimeEntriesTabService extends BaseTabService<TimeEntriesTabModalViewResolversMap> {
  constructor(
    private readonly timeEntriesTabDataService: TimeEntriesTabDataService,
    private readonly timeEntryModalService: TimeEntryModalService,
    private readonly timeEntriesTabView: TimeEntriesTabView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.TimeEntries, {
      [TimeEntriesTabModalName.CreateTimeEntry]:
        (params) =>
          this.getCreateTimeEntryModal(params),
      [TimeEntriesTabModalName.UpdateTimeEntry]:
        (params) =>
          this.getUpdateTimeEntryModal(params),
      [TimeEntriesTabModalName.DeleteEntry]:
        (params) =>
          this.getDeleteTimeEntryModal(params),
    });
  }

  public async getTabView({ user, metadata = {} }: IGetTimeEntriesTabViewParams) {
    const seesAllEntries =
      ALL_ENTRIES_ROLES.includes(user.role) && !metadata.ownEntriesOnly;
    const timeEntriesListData =
      await this.timeEntriesTabDataService.getTimeEntriesTabData({
        slackTeamId: user.slack_team_id,
        page: metadata.page,
        filters: {
          projectId: metadata.filters?.project?.id,
          userId: seesAllEntries ? undefined : user.id,
          fromDate: metadata?.filters?.fromDate,
          toDate: metadata?.filters?.toDate,
        },
      });

    return this.timeEntriesTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        timeEntriesListData,
      },
      metadata,
    );
  }

  private async getCreateTimeEntryModal({
    user,
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    return this.timeEntryModalService.getModal({
      user,
      errorMessage,
      pageMetadata,
    });
  }

  private async getUpdateTimeEntryModal({
    entryId,
    user,
    errorMessage,
    pageMetadata,
  }: ITimeEntryModalViewParams) {
    return this.timeEntryModalService.getModal(
      {
        user,
        errorMessage,
        timeEntryId: entryId,
        pageMetadata,
      },
    );
  }

  private async getDeleteTimeEntryModal({
    entryId,
    errorMessage,
    pageMetadata,
  }: ITimeEntryModalViewParams) {
    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteTimeEntry,
        title: 'Delete time entry',
        message: 'This time entry will be permanently deleted.',
        errorMessage,
      },
      { id: entryId, pageMetadata },
    );
  }
}
