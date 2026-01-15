import { Injectable } from '@nestjs/common';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, { IPublishBaseParams } from '@modules/slack/common/services/base-tab.service';
import { TimeAndBillingTabView } from '@modules/slack/tabs/time-and-billing/views/time-and-billing-tab.view';

export type IGetPeopleTabViewParams = IPublishBaseParams;

@Injectable()
export class TimeAndBillingTabService extends BaseTabService<never> {
  public constructor(
    private readonly timeAndBillingViewService: TimeAndBillingTabView,
  ) {
    super(TabId.TimeAndBilling);
  }

  protected async getTabView(params: IGetPeopleTabViewParams) {
    return this.timeAndBillingViewService.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
      },
    );
  }
}
