import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { OverflowAction } from '@slack/bolt';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/services/holidays-tab.service';
import { VacationPoliciesTabService } from 'src/slack/services/vacation-policies-tab.service';
import {
  HolidaysTabViewActionId,
  IHolidaysTabMetadata,
} from 'src/slack/services/slack-views/tab-views/holidays-tab-view.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HolidaysTabView,
  type: 'block_actions',
})
export default class HolidaysTabActionHandler {
  private readonly logger = new Logger(HolidaysTabActionHandler.name);

  public constructor(
    private readonly policiesTabService: VacationPoliciesTabService,
    private readonly holidaysTabService: HolidaysTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case HolidaysTabViewActionId.AddHoliday: {
        await this.holidaysTabService.openModal(
          payload.trigger_id || user.slack_id,
          HolidaysTabModalName.CreateHoliday,
          { user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case HolidaysTabViewActionId.UploadHolidaysFromCountry: {
        await this.holidaysTabService.openModal(
          payload.trigger_id || user.slack_id,
          HolidaysTabModalName.ImportHolidays,
          { user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case HolidaysTabViewActionId.ManageHolidayMenu: {
        await this.handleManageHolidayMenuAction(payload, user);

        break;
      }
      case HolidaysTabViewActionId.ChangeYear: {
        await this.handleSelectYear(payload, user);

        break;
      }
      case HolidaysTabViewActionId.BackToPolicies: {
        await this.policiesTabService.publish({ user });

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }

  private async handleSelectYear(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedYear = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedYear) {
      this.logger.warn(
        `${HolidaysTabViewActionId.ChangeYear} triggered without selected_option`,
      );

      return;
    }

    const pageMetadata = JSON.parse(
      payload.view.private_metadata,
    ) as IHolidaysTabMetadata;

    await this.holidaysTabService.publish({
      user,
      selectedYear: parseInt(selectedYear, 10),
      policyId: pageMetadata.policyId,
    });
  }

  private async handleManageHolidayMenuAction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn(
        `${HolidaysTabViewActionId.ManageHolidayMenu} triggered without selected_option`,
      );

      return;
    }

    // e.g. TeamsTabViewActionId:team_id
    const [actionType, holidayId] = selectedValue.split(':');

    switch (actionType as HolidaysTabViewActionId) {
      case HolidaysTabViewActionId.EditHoliday: {
        await this.holidaysTabService.openModal(
          payload.trigger_id || user.slack_id,
          HolidaysTabModalName.UpdateHoliday,
          { user, holidayId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case HolidaysTabViewActionId.ToggleHolidayStatus: {
        await this.holidaysTabService.openModal(
          payload.trigger_id || user.slack_id,
          HolidaysTabModalName.ToggleHolidayStatus,
          { user, holidayId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case HolidaysTabViewActionId.DeleteHoliday: {
        await this.holidaysTabService.openModal(
          payload.trigger_id || user.slack_id,
          HolidaysTabModalName.DeleteHoliday,
          { user, holidayId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Team Tab Menu actionType: ${actionType}`);
      }
    }
  }
}
