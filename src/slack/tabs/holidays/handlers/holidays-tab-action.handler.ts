import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/tabs/holidays/services/holidays-tab.service';
import {
  HolidaysTabViewActionId,
  IHolidaysTabMetadata,
} from 'src/slack/tabs/holidays/views/holidays-tab.view';
import { ActionMapType } from 'src/slack/common/handlers/base-tab-action.handler';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import {
  withPagination,
  withSelectFilter,
} from 'src/slack/common/utils/tab-list.utils';
import { withMenuAction } from 'src/slack/common/utils/slack-menu.utils';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HolidaysTabView,
  type: 'block_actions',
})
export default class HolidaysTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(HolidaysTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly holidaysTabService: HolidaysTabService,
    tabNavigationService: TabNavigationService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [HolidaysTabViewActionId.AddHoliday]: this.handleAddHoliday,
      [HolidaysTabViewActionId.UploadHolidaysFromCountry]:
        this.handleUploadHolidaysFromCountry,
      [HolidaysTabViewActionId.ManageHolidayMenu]: withMenuAction(
        this.handleManageHolidayMenuAction,
      ),
      [HolidaysTabViewActionId.ChangeYear]: withSelectFilter(
        'selectedYear',
        this.updateTab,
      ),
      [HolidaysTabViewActionId.BackToPolicies]: (
        _payload: ISlackInteractionPayload,
        user: IUserViewModel,
      ) => {
        this.tabNavigationService.navigate(TabId.VacationPolicies, { user });
      },
      [HolidaysTabViewActionId.CountryHolidaysPaginationPrev]:
        paginationHandler,
      [HolidaysTabViewActionId.CountryHolidaysPaginationNext]:
        paginationHandler,
    };
  }

  private updateTab = async (
    metadata: IHolidaysTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.holidaysTabService.publish({
      user,
      metadata,
    });
  };

  private handleUploadHolidaysFromCountry = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.holidaysTabService.openModal(
      payload.trigger_id || user.slack_id,
      HolidaysTabModalName.ImportHolidays,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleAddHoliday = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.holidaysTabService.openModal(
      payload.trigger_id || user.slack_id,
      HolidaysTabModalName.CreateHoliday,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleManageHolidayMenuAction = async (
    actionType: HolidaysTabViewActionId,
    holidayId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
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
  };
}
