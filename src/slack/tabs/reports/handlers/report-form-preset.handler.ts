import { RATE_ROLES } from 'src/projects/constants/rate-roles';
import { Injectable } from '@nestjs/common';
import type { StaticSelectAction } from '@slack/bolt/dist/types/actions/block-action';
import { isPeriodPreset, presetPeriod } from '@common/utils/period-presets';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import { PERIOD_PRESET_ACTION_ID } from '@modules/slack/tabs/reports/views/period-fields';
import { SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';

type ReportForm =
  | ReportsModalName.TimeReport
  | ReportsModalName.BillingReport
  | ReportsModalName.Uninvoiced;

// A quick period chosen in a report form fills its dates: the form is
// rebuilt with them under new block_ids (views.update keeps what a field
// with the same block_id holds), so the other fields keep what the user
// chose.
abstract class ReportFormPresetHandler extends BaseActionHandler {
  protected abstract readonly form: ReportForm;
  protected actionMap: ActionMapType = {
    [PERIOD_PRESET_ACTION_ID]: (payload, user) => this.fillDates(payload, user),
  };

  protected constructor(
    private readonly reportsTabService: ReportsTabService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    super();
  }

  private async fillDates(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const preset = (payload.actions[0] as StaticSelectAction).selected_option
      ?.value;

    if (!isPeriodPreset(preset) || !payload.view?.id) {
      return;
    }

    const view = await this.reportsTabService.getModalView(this.form, {
      user,
      period: {
        ...presetPeriod(preset),
        version: `${preset}.${Date.now().toString(36)}`,
      },
    });

    // An older click's rebuild fails (hash_conflict) instead of replacing a
    // newer one.
    await this.slackCommunicationService.updateView(
      payload.view.id,
      view,
      user.slack_team_id,
      payload.view.hash,
    );
  }
}

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeReportFormSubmit,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Reports),
})
export class TimeReportPresetHandler extends ReportFormPresetHandler {
  protected readonly form = ReportsModalName.TimeReport;

  public constructor(
    reportsTabService: ReportsTabService,
    slackCommunicationService: SlackCommunicationService,
  ) {
    super(reportsTabService, slackCommunicationService);
  }
}

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.BillingReportFormSubmit,
  type: 'block_actions',
  allowedRoles: RATE_ROLES,
})
export class BillingReportPresetHandler extends ReportFormPresetHandler {
  protected readonly form = ReportsModalName.BillingReport;

  public constructor(
    reportsTabService: ReportsTabService,
    slackCommunicationService: SlackCommunicationService,
  ) {
    super(reportsTabService, slackCommunicationService);
  }
}

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UninvoicedReportFormSubmit,
  type: 'block_actions',
  allowedRoles: SNAPSHOT_ROLES,
})
export class UninvoicedReportPresetHandler extends ReportFormPresetHandler {
  protected readonly form = ReportsModalName.Uninvoiced;

  public constructor(
    reportsTabService: ReportsTabService,
    slackCommunicationService: SlackCommunicationService,
  ) {
    super(reportsTabService, slackCommunicationService);
  }
}
