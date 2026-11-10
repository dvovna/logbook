import { Injectable } from '@nestjs/common';
import type {
  CheckboxesAction,
  StaticSelectAction,
} from '@slack/bolt/dist/types/actions/block-action';
import { ALL_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntriesTabModalName } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-modal-name.enum';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import { TimesheetFormMetadata } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { MAX_TIMESHEET_ROWS } from 'src/time-entries/types/timesheet.types';

// Adding a row or showing the weekend rebuilds the open form (views.update).
// Its cells keep their block_ids, so Slack keeps what was typed in them.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimesheetForm,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class TimesheetFormActionHandler extends BaseActionHandler {
  protected actionMap: ActionMapType = {
    [TimesheetFormActionId.AddProject]: (payload, user) =>
      this.addProject(payload, user),
    [TimesheetFormActionId.ShowWeekend]: (payload, user) =>
      this.showWeekend(payload, user),
  };

  public constructor(
    private readonly timesheetService: TimesheetService,
    private readonly timeEntriesTabService: TimeEntriesTabService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    super();
  }

  // The project comes from the client: only one the user may log time on.
  private async addProject(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const metadata = parseMetadata<TimesheetFormMetadata>(payload);
    const projectId = (payload.actions[0] as StaticSelectAction).selected_option
      ?.value;
    const added = metadata.addedProjectIds;

    if (
      !projectId ||
      added.includes(projectId) ||
      added.length >= MAX_TIMESHEET_ROWS ||
      !(await this.timesheetService.allowedProjects(user)).some(
        ({ id }) => id === projectId,
      )
    ) {
      return;
    }

    await this.updateForm(payload, user, {
      ...metadata,
      addedProjectIds: [...added, projectId],
    });
  }

  private async showWeekend(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const { selected_options } = payload.actions[0] as CheckboxesAction;

    await this.updateForm(payload, user, {
      ...parseMetadata<TimesheetFormMetadata>(payload),
      showWeekend: !!selected_options?.length,
    });
  }

  private async updateForm(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
    metadata: TimesheetFormMetadata,
  ) {
    if (!payload.view?.id) {
      return;
    }

    await this.slackCommunicationService.updateView(
      payload.view.id,
      await this.timeEntriesTabService.getModalView(
        TimeEntriesTabModalName.FillWeek,
        { user, metadata },
      ),
      user.slack_team_id,
    );
  }
}
