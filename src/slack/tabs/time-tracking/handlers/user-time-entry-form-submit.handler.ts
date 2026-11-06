import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import UserTimeEntryModalViewValuesParser, {
  ITimeEntryFormViewData,
} from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { BaseTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/base-time-entry-form-submit.handler';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

// Everyone but admins logs their own time, as a draft.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UserTimeEntry,
  type: 'view_submission',
})
export class UserTimeEntryFormSubmitHandler extends BaseTimeEntryFormSubmitHandler<ITimeEntryFormViewData> {
  public constructor(
    timeEntryFormModalView: TimeEntryFormModalView,
    timeEntryModalService: TimeEntryModalService,
    timeEntriesService: TimeEntriesService,
    tabNavigationService: TabNavigationService,
    formParser: UserTimeEntryModalViewValuesParser,
  ) {
    super(
      timeEntryFormModalView,
      timeEntryModalService,
      timeEntriesService,
      tabNavigationService,
      formParser,
    );
  }

  protected create(data: ITimeEntryFormViewData, user: IUserViewModel) {
    return this.timeEntriesService.create(
      {
        ...this.getEntryFields(data),
        userId: user.id,
        teamId: user.team_id,
        status: TimeEntryStatus.Draft,
      },
      user,
    );
  }

  protected update(
    id: string,
    data: ITimeEntryFormViewData,
    user: IUserViewModel,
  ) {
    return this.timeEntriesService.update(
      { id, slackTeamId: user.slack_team_id },
      this.getEntryFields(data),
      user,
    );
  }
}
