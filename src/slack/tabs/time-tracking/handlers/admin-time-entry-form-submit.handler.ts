import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import AdminTimeEntryModalViewValuesParser, {
  IAdminTimeEntryFormViewData,
} from '@modules/slack/tabs/time-tracking/parsers/admin-time-entry-modal-view-values.parser';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { BaseTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/base-time-entry-form-submit.handler';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

// An admin logs time for the user and in the status chosen in the form.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.AdminTimeEntry,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class AdminTimeEntryFormSubmitHandler extends BaseTimeEntryFormSubmitHandler<IAdminTimeEntryFormViewData> {
  public constructor(
    timeEntryFormModalView: TimeEntryFormModalView,
    timeEntryModalService: TimeEntryModalService,
    timeEntriesService: TimeEntriesService,
    tabNavigationService: TabNavigationService,
    private readonly usersService: UsersService,
    formParser: AdminTimeEntryModalViewValuesParser,
  ) {
    super(
      timeEntryFormModalView,
      timeEntryModalService,
      timeEntriesService,
      tabNavigationService,
      formParser,
    );
  }

  protected async create(
    data: IAdminTimeEntryFormViewData,
    user: IUserViewModel,
  ) {
    return this.timeEntriesService.create(
      {
        ...this.getEntryFields(data),
        ...(await this.getOwnerFields(data, user)),
        status: data.status.value,
      },
      user,
    );
  }

  protected async update(
    id: string,
    data: IAdminTimeEntryFormViewData,
    user: IUserViewModel,
  ) {
    return this.timeEntriesService.update(
      { id, slackTeamId: user.slack_team_id },
      {
        ...this.getEntryFields(data),
        ...(await this.getOwnerFields(data, user)),
        status: data.status.value,
      },
      user,
    );
  }

  // The chosen user, who may have left since, and their team: the entry
  // counts for that team.
  private async getOwnerFields(
    data: IAdminTimeEntryFormViewData,
    user: IUserViewModel,
  ) {
    const owner = await this.usersService.findOne({
      id: data[TimeEntriesTabViewActionId.SelectUser].value,
      slackTeamId: user.slack_team_id,
      includeInactive: true,
    });

    if (!owner) {
      throw new ValidationError('User not found.');
    }

    return { userId: owner.id, teamId: owner.team_id };
  }
}
