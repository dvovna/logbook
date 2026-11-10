import { truncate } from 'lodash';
import { getDisplayTime } from '@common/utils/time.utils';
import { formatDate } from '@common/utils/date.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
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
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { currentWeekStart, weekDays } from '@common/utils/period-presets';
import {
  TimesheetFormMetadata,
  TimesheetFormModalView,
} from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';

interface ITimeEntryModalViewParams extends IOpenModalBaseParams<string> {
  entryId: string;
}

export type ITimesheetFormModalParams = IOpenModalBaseParams & {
  metadata: TimesheetFormMetadata;
};

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
  [TimeEntriesTabModalName.FillWeek]: (
    params: ITimesheetFormModalParams,
  ) => Promise<View>;
};

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
    private readonly timeEntriesService: TimeEntriesService,
    private readonly timesheetService: TimesheetService,
    private readonly timesheetFormModalView: TimesheetFormModalView,
  ) {
    super(TabId.TimeEntries, {
      [TimeEntriesTabModalName.CreateTimeEntry]: (params) =>
        this.getCreateTimeEntryModal(params),
      [TimeEntriesTabModalName.UpdateTimeEntry]: (params) =>
        this.getUpdateTimeEntryModal(params),
      [TimeEntriesTabModalName.DeleteEntry]: (params) =>
        this.getDeleteTimeEntryModal(params),
      [TimeEntriesTabModalName.FillWeek]: (params) =>
        this.getTimesheetFormModal(params),
    });
  }

  public async getTabView({
    user,
    metadata = {},
  }: IGetTimeEntriesTabViewParams) {
    const seesAllEntries =
      isTimeEntriesAdmin(user.role) && !metadata.ownEntriesOnly;
    // My time is a week: its table, and the list of that week's entries. Time
    // logs filters by dates instead.
    const weekStart = seesAllEntries
      ? undefined
      : (metadata.weekStart ?? currentWeekStart());
    const days = weekStart ? weekDays(weekStart) : undefined;
    const filters = {
      projectId: metadata.filters?.project?.id,
      userId: seesAllEntries ? metadata.filters?.user?.id : user.id,
      fromDate: days ? days[0] : metadata?.filters?.fromDate,
      toDate: days ? days[6] : metadata?.filters?.toDate,
    };
    const [timeEntriesListData, week, openBefore] = await Promise.all([
      this.timeEntriesTabDataService.getTimeEntriesTabData({
        slackTeamId: user.slack_team_id,
        page: metadata.page,
        filters,
      }),
      weekStart ? this.timesheetService.getWeek(user, weekStart) : undefined,
      weekStart
        ? this.timesheetService.findOpenBefore(user, weekStart)
        : undefined,
    ]);

    const [dayTotals, billedIds] = await Promise.all([
      this.timeEntriesTabDataService.getDayTotals({
        slackTeamId: user.slack_team_id,
        days: [
          ...new Set(timeEntriesListData.items.map((item) => item.work_date)),
        ],
        filters,
      }),
      this.timeEntriesService.findBilledIds(
        user.slack_team_id,
        timeEntriesListData.items.map(({ id }) => id),
      ),
    ]);

    return this.timeEntriesTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        dayTotals,
        canFilterByUser: seesAllEntries,
        viewerId: user.id,
        week,
        openBefore,
        timeEntriesListData,
        billedIds,
      },
      { ...metadata, weekStart },
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
    return this.timeEntryModalService.getModal({
      user,
      errorMessage,
      timeEntryId: entryId,
      pageMetadata,
    });
  }

  // Fill in the week or the day (`metadata.mode`; the day's rows are those of
  // its week): the viewer's own time, whatever their role.
  private async getTimesheetFormModal({
    user,
    errorMessage,
    metadata,
  }: ITimesheetFormModalParams) {
    const { week, projects } = await this.timesheetService.getForm(
      user,
      metadata.weekStart,
      metadata.addedProjectIds,
    );

    return this.timesheetFormModalView.getView(
      { mode: metadata.mode, week, projects, errorMessage },
      metadata,
    );
  }

  // Says which entry goes. The ID comes from the client: only Admin and HR
  // see others' entries.
  private async getDeleteTimeEntryModal({
    entryId,
    errorMessage,
    pageMetadata,
    user,
  }: ITimeEntryModalViewParams) {
    const entry = await this.timeEntriesService.findOneWithValidation({
      id: entryId,
      slackTeamId: user.slack_team_id,
    });

    if (entry.user_id !== user.id && !isTimeEntriesAdmin(user.role)) {
      throw new ForbiddenException('You cannot delete this time entry.');
    }

    const what = [
      `*${getDisplayTime(entry.minutes)}*`,
      entry.project?.name && `on *${escapeMrkdwn(entry.project.name)}*`,
      formatDate(entry.work_date),
    ]
      .filter(Boolean)
      .join(' ');
    const description = entry.description
      ? `\n_${escapeMrkdwn(truncate(entry.description.replace(/\s+/g, ' '), { length: 80 }))}_`
      : '';

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteTimeEntry,
        title: 'Delete time entry',
        message: `${what} will be deleted.${description}`,
        errorMessage,
      },
      { id: entryId, pageMetadata },
    );
  }
}
