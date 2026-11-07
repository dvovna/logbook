import { getDisplayTime } from '@common/utils/time.utils';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import {
  ITimeEntryModalViewMetadata,
  TimeEntryFormModalView,
} from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { ITimeEntryFormViewData } from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// The Log Time / Edit Time Log form. Opened from the Home tab it goes back
// there; opened from the time entries tab (it carries that tab's metadata)
// it re-renders that tab.
export abstract class BaseTimeEntryFormSubmitHandler<
  FormData extends ITimeEntryFormViewData,
> extends BaseModalFormSubmitHandler<
  ITimeEntryModalViewMetadata,
  FormData,
  ITimeEntryViewModel
> {
  protected readonly errorFields = {
    minutes: 'hours' as const,
    project: 'projectId' as const,
  };

  protected constructor(
    protected readonly timeEntryFormModalView: TimeEntryFormModalView,
    protected readonly timeEntryModalService: TimeEntryModalService,
    protected readonly timeEntriesService: TimeEntriesService,
    protected readonly tabNavigationService: TabNavigationService,
    formParser: BaseValuesParser<FormData>,
  ) {
    super(formParser);
  }

  protected abstract create(
    data: FormData,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel>;

  protected abstract update(
    id: string,
    data: FormData,
    user: IUserViewModel,
  ): Promise<ITimeEntryViewModel>;

  protected onSubmit(
    data: FormData,
    metadata: ITimeEntryModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  // The fields both forms have.
  protected getEntryFields(data: ITimeEntryFormViewData) {
    return {
      projectId: data.projectId.value,
      workDate: new Date(data.workDate),
      minutes: data.hours * 60,
      description: data.description,
    };
  }

  protected successResponse(
    entry: ITimeEntryViewModel,
    user: IUserViewModel,
    metadata: ITimeEntryModalViewMetadata,
  ) {
    // E.g. "✅ Saved as a draft: 1h 30m on Website. Submit it …".
    const what = `${getDisplayTime(entry.minutes)}${entry.project?.name ? ` on ${entry.project.name}` : ''}`;
    const notice =
      entry.status === TimeEntryStatus.Draft
        ? `✅ Saved as a draft: ${what}. Submit it from Home when your time is complete.`
        : `✅ ${metadata.id ? 'Updated' : 'Saved'}: ${what}.`;

    if (metadata.pageMetadata) {
      this.tabNavigationService.navigate(TabId.TimeEntries, {
        user,
        metadata: JSON.parse(metadata.pageMetadata) as ITimeEntriesTabMetaData,
        notice,
      });
    } else {
      this.tabNavigationService.navigate(TabId.Home, { user, notice });
    }

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: FormData,
    metadata: ITimeEntryModalViewMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeEntryModalService.getModal({
        errorMessage,
        user,
        timeEntryId: metadata.id ?? undefined,
        pageMetadata: metadata.pageMetadata,
      }),
    );
  }
}
