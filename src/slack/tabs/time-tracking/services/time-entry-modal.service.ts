import { ForbiddenException, Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

export interface ITimeEntryModalViewParams extends IOpenModalBaseParams {
  timeEntryId?: string;
  pageMetadata?: string;
}

@Injectable()
export class TimeEntryModalService {
  public constructor(
    private readonly timeEntryFormModalView: TimeEntryFormModalView,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly timesheetService: TimesheetService,
  ) {}

  public async getModal({
    timeEntryId,
    user,
    errorMessage,
    pageMetadata = '',
  }: ITimeEntryModalViewParams): Promise<View> {
    const [projects, timeEntry] = await Promise.all([
      this.timesheetService.allowedProjects(user),
      timeEntryId
        ? this.timeEntriesService.findOneWithValidation({
            id: timeEntryId,
            slackTeamId: user.slack_team_id,
          })
        : undefined,
    ]);

    // The ID comes from the client: only Admin and HR open others' entries.
    if (
      timeEntry &&
      timeEntry.user_id !== user.id &&
      !isTimeEntriesAdmin(user.role)
    ) {
      throw new ForbiddenException('You cannot edit this time entry.');
    }

    return this.timeEntryFormModalView.getView(
      {
        initialData: timeEntry,
        userProjects: projects,
        callbackId: isTimeEntriesAdmin(user.role)
          ? ViewCallbackId.AdminTimeEntry
          : ViewCallbackId.UserTimeEntry,
        errorMessage,
        user,
      },
      {
        pageMetadata,
        id: timeEntryId,
      },
    );
  }
}
