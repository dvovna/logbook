import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { TabId, TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import {
  ITimeEntryModalViewMetadata,
  TimeEntryFormModalView,
} from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import UserTimeEntryModalViewValuesParser, {
  ITimeEntryFormViewData,
} from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.AdminTimeEntry,
  type: 'view_submission',
})
export class CreateUserTimeEntryHandler extends BaseModalFormSubmitHandler<
  ITimeEntryModalViewMetadata,
  ITimeEntryFormViewData,
  ITimeEntryViewModel
> {
  public constructor(
    private readonly timeEntryFormModalView: TimeEntryFormModalView,
    private readonly timeEntryModalService: TimeEntryModalService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly tabNavigationService: TabNavigationService,
    timeEntryModalViewValuesParser: UserTimeEntryModalViewValuesParser,
  ) {
    super(timeEntryModalViewValuesParser);
  }

  protected successResponse(
    _: ITimeEntryViewModel,
    user: IUserViewModel,
    metadata: ITimeEntryModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.Home, {
      user,
    });

    return SlackViewResponseFactory.update(
      this.timeEntryFormModalView.getSuccessView(
        `✅ Time Log was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: ITimeEntryFormViewData,
    _: ITimeEntryModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.timeEntriesService.create(
      {
        clientId: data.clientId?.value,
        projectId: data.projectId.value,
        description: data.description,
        status: TimeEntryStatus.Draft,
        userId: user.id,
        billable: data.billable?.[0]?.value === YesNoValue.Yes,
        workDate: new Date(data.workDate),
        minutes: data.hours * 60,
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ITimeEntryFormViewData,
    _: ITimeEntryModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeEntryModalService.getModal({
        errorMessage,
        user,
      }),
    );
  }
}
