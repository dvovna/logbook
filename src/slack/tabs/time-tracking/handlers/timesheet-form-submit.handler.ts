import { Injectable } from '@nestjs/common';
import { ALL_ROLES } from '@common/constants/role-groups';
import { weekDays } from '@common/utils/period-presets';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ISlackViewSubmissionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  ITimesheetFormData,
  parseTimesheetForm,
} from '@modules/slack/tabs/time-tracking/parsers/timesheet-form.parser';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import { TimesheetFormMetadata } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { weekLabel } from '@modules/slack/tabs/time-tracking/views/timesheet-table.view';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { ITimesheetSaveResult } from 'src/time-entries/types/timesheet.types';

// Saves Fill in the week, for the viewer's own time whatever their role, and
// goes back to My time. Null: the form had nothing to save.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimesheetForm,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class TimesheetFormSubmitHandler extends BaseModalFormSubmitHandler<
  TimesheetFormMetadata,
  ITimesheetFormData,
  ITimesheetSaveResult | null
> {
  public constructor(
    private readonly timesheetService: TimesheetService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  // The cells differ from form to form: no fixed field config fits them.
  protected getFormData(payload: ISlackViewSubmissionPayload) {
    return parseTimesheetForm(payload.view);
  }

  // An error about a cell shows at its input. A cell the form has no input
  // for came from the client: its error shows in the modal.
  protected blockIdOfField(
    field: string,
    payload: ISlackViewSubmissionPayload,
  ): string | null {
    return (payload.view.blocks ?? []).some(
      (block) => block.type === 'input' && block.block_id === field,
    )
      ? field
      : null;
  }

  protected async onSubmit(
    { cells, submitWeek }: ITimesheetFormData,
    metadata: TimesheetFormMetadata,
    user: IUserViewModel,
  ) {
    const days = weekDays(metadata.weekStart);
    // The form's week only: a cell of another day came from the client.
    const inputs = cells.filter((cell) => days.includes(cell.date));

    if (!inputs.length && !submitWeek) {
      return null;
    }

    return this.timesheetService.saveCells(user, inputs, {
      submitWeekStart: submitWeek ? metadata.weekStart : undefined,
    });
  }

  protected successResponse(
    result: ITimesheetSaveResult | null,
    user: IUserViewModel,
    metadata: TimesheetFormMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.TimeEntries, {
      user,
      metadata: metadata.pageMetadata
        ? (JSON.parse(metadata.pageMetadata) as ITimeEntriesTabMetaData)
        : { ownEntriesOnly: true, weekStart: metadata.weekStart },
      // '✅ 26h saved for the week of 15 Jun.'
      notice: result
        ? `✅ ${result.minutes ? getDisplayTime(result.minutes) : '0h'} saved for the week of ${weekLabel(metadata.weekStart)}.`
        : undefined,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ITimesheetFormData,
    metadata: TimesheetFormMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeEntriesTabService.getModalView(
        TimeEntriesTabModalName.FillWeek,
        { user, errorMessage, metadata },
      ),
    );
  }
}
