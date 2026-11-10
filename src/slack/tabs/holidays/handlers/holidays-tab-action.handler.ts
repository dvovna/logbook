import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from '@modules/slack/tabs/holidays/services/holidays-tab.service';
import {
  HolidaysTabViewActionId,
  IHolidaysTabMetadata,
} from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import {
  withPagination,
  withSelectFilter,
} from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HolidaysTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Holidays),
})
export default class HolidaysTabActionHandler extends BaseTabActionHandler {
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
        this.logger,
      ),
      [HolidaysTabViewActionId.ChangeYear]: withSelectFilter(
        'selectedYear',
        this.updateTab,
      ),
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
