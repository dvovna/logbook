import { Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import UserRole from '@common/enums/user-role.enum';

export interface ITimeEntryModalViewParams
  extends IOpenModalBaseParams {
  timeEntryId?: string;
  pageMetadata?: string;
}

const ADMIN_LEVEL_USER_ROLES = [UserRole.Admin];

@Injectable()
export class TimeEntryModalService {
  public constructor(
    private readonly timeEntryFormModalView: TimeEntryFormModalView,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
    private readonly timeEntriesService: TimeEntriesService,
  ) {}

  public async getModal({
    timeEntryId,
    user,
    errorMessage,
    pageMetadata = '',
  }: ITimeEntryModalViewParams): Promise<View> {
    const userProjects = await this.getUserProjectsQuery.execute({
      userId: user.id,
      slackTeamId: user.slack_team_id,
    });

    const timeEntry = timeEntryId
      ? await this.timeEntriesService.findOneWithValidation({
        id: timeEntryId,
        slackTeamId: user.slack_team_id,
      })
      : undefined;

    return this.timeEntryFormModalView.getView(
      {
        initialData: timeEntry,
        userProjects,
        callbackId: ADMIN_LEVEL_USER_ROLES.includes(user.role)
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
