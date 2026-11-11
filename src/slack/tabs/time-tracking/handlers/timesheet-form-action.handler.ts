import { Injectable, Logger } from '@nestjs/common';
import type {
  CheckboxesAction,
  DatepickerAction,
  StaticSelectAction,
} from '@slack/bolt/dist/types/actions/block-action';
import { ALL_ROLES } from '@common/constants/role-groups';
import { runInBackground } from '@common/utils/run-in-background';
import { isIsoDate } from '@common/utils/date.utils';
import { weekStartOf } from '@common/utils/period-presets';
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
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import { TimesheetFormMetadata } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { IUserProject } from 'src/projects/queries/get-user-projects.query';
import { MAX_TIMESHEET_ROWS } from 'src/time-entries/constants/timesheet';

// Adding a row, showing the weekend or choosing another day rebuilds the open
// form (views.update).
// Its cells keep their block_ids, so Slack keeps what was typed in them.
// Slack needs nothing in the answer to a click: the app answers at once and
// rebuilds the form after it.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimesheetForm,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class TimesheetFormActionHandler extends BaseActionHandler {
  private readonly logger = new Logger(TimesheetFormActionHandler.name);

  protected actionMap: ActionMapType = {
    [TimesheetFormActionId.AddProject]: (payload, user) =>
      this.afterAnswer('add a project to', () =>
        this.addProject(payload, user),
      ),
    [TimesheetFormActionId.ShowWeekend]: (payload, user) =>
      this.afterAnswer('show the weekend in', () =>
        this.showWeekend(payload, user),
      ),
    [TimesheetFormActionId.Day]: (payload, user) =>
      this.afterAnswer('change the day of', () =>
        this.changeDay(payload, user),
      ),
  };

  public constructor(
    private readonly timeEntriesTabService: TimeEntriesTabService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    super();
  }

  private afterAnswer(what: string, work: () => Promise<void>) {
    runInBackground(this.logger, `${what} the week form`, work);
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
      added.length >= MAX_TIMESHEET_ROWS
    ) {
      return;
    }

    await this.updateForm(
      payload,
      user,
      { ...metadata, addedProjectIds: [...added, projectId] },
      (projects) => projects.some(({ id }) => id === projectId),
    );
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

  // The date comes from the client: a real day, or nothing changes.
  private async changeDay(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const { selected_date: date } = payload.actions[0] as DatepickerAction;
    const metadata = parseMetadata<TimesheetFormMetadata>(payload);

    if (metadata.mode !== 'day' || !isIsoDate(date)) {
      return;
    }

    await this.updateForm(payload, user, {
      ...metadata,
      date,
      weekStart: weekStartOf(date),
    });
  }

  private async updateForm(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
    metadata: TimesheetFormMetadata,
    allows: (projects: IUserProject[]) => boolean = () => true,
  ) {
    if (!payload.view?.id) {
      return;
    }

    const { view: form, projects } =
      await this.timeEntriesTabService.getTimesheetForm({ user, metadata });

    if (!allows(projects)) {
      return;
    }

    // The form as this click saw it.
    await this.slackCommunicationService.updateView(
      payload.view.id,
      form,
      user.slack_team_id,
      payload.view.hash,
    );
  }
}
