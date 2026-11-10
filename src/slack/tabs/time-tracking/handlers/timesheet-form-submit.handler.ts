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
import {
  COMMENT_BLOCK_ID,
  TimesheetFormMetadata,
} from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { weekLabel } from '@common/utils/date.utils';
import { dayLabel } from '@modules/slack/tabs/time-tracking/views/timesheet-table.view';
import { ITimeEntriesTabMetaData } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { ITimesheetSaveResult } from 'src/time-entries/types/timesheet.types';

// The viewer's own time, whatever their role. Null: the form had nothing
// to save.
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

  // An error about a cell shows at its input, one about the comment at the
  // comment. A cell the form has no input for came from the client: its
  // error shows in the modal.
  protected blockIdOfField(
    field: string,
    payload: ISlackViewSubmissionPayload,
  ): string | null {
    const blockId = field === 'comment' ? COMMENT_BLOCK_ID : field;

    return (payload.view.blocks ?? []).some(
      (block) => block.type === 'input' && block.block_id === blockId,
    )
      ? blockId
      : null;
  }

  protected async onSubmit(
    { cells, submitWeek, comment }: ITimesheetFormData,
    metadata: TimesheetFormMetadata,
    user: IUserViewModel,
  ) {
    const isDay = metadata.mode === 'day';
    // The form's week, or its day: a cell of another day came from the client.
    const inputs = cells.filter((cell) =>
      isDay
        ? cell.date === metadata.date
        : weekDays(metadata.weekStart).includes(cell.date),
    );
    const dayComment = isDay ? comment : undefined;

    if (!inputs.length && !submitWeek && !dayComment) {
      return null;
    }

    return this.timesheetService.saveCells(user, inputs, {
      comment: dayComment,
      submitWeekStart: submitWeek ? metadata.weekStart : undefined,
    });
  }

  // My time on the form's week: the day form's day may be in another week
  // than the one My time showed, and the notice is about that day.
  protected successResponse(
    result: ITimesheetSaveResult | null,
    user: IUserViewModel,
    metadata: TimesheetFormMetadata,
  ) {
    const page: ITimeEntriesTabMetaData = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as ITimeEntriesTabMetaData)
      : { ownEntriesOnly: true };

    this.tabNavigationService.navigate(TabId.TimeEntries, {
      user,
      metadata:
        page.weekStart === metadata.weekStart
          ? page
          : { ...page, weekStart: metadata.weekStart, page: 1 },
      notice: result ? this.noticeOf(result, metadata) : undefined,
    });

    return SlackViewResponseFactory.success();
  }

  private noticeOf(
    result: ITimesheetSaveResult,
    { mode, date, weekStart }: TimesheetFormMetadata,
  ) {
    const day = mode === 'day' && date;
    const minutes = day ? (result.minutesByDate[date] ?? 0) : result.minutes;

    return `✅ Saved. ${day ? dayLabel(date) : `Week of ${weekLabel(weekStart)}`}: ${
      minutes ? getDisplayTime(minutes) : '0h'
    }.`;
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
