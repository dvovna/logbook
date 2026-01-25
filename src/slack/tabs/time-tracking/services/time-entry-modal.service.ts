import { Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';

export interface ITimeEntryModalViewParams
  extends IOpenModalBaseParams {
  callbackId?: ViewCallbackId.AdminTimeEntry | ViewCallbackId.UserTimeEntry;
  timeEntryId?: string;
  pageMetadata?: string;
}

@Injectable()
export class TimeEntryModalService {
  public constructor(
    private timeEntryFormModalView: TimeEntryFormModalView,
    private timeEntriesService: TimeEntriesService,
    private getUserProjectsQuery: GetUserProjectsQuery,
  ) {}

  public async getModal({
    timeEntryId,
    user,
    callbackId = ViewCallbackId.AdminTimeEntry,
    errorMessage,
    pageMetadata = '',
  }: ITimeEntryModalViewParams): Promise<View> {
    const userProjects = await this.getUserProjectsQuery.execute({
      userId: user.id,
      slackTeamId: user.slack_team_id,
    });

    return this.timeEntryFormModalView.getView(
      {
        userProjects,
        callbackId,
        errorMessage,
        userRole: user.role,
      },
      {
        pageMetadata,
        id: timeEntryId,
      },
    );
  }
}
