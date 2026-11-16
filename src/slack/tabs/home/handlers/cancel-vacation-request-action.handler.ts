import { ALL_ROLES } from '@common/constants/role-groups';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { IConfirmationModalViewMetadata } from '@modules/slack/common/views/components/confirmation-modal.view';
import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { HomeTabService } from '@modules/slack/tabs/home/services/home-tab.service';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { CancelRequestModalService } from '@modules/slack/tabs/vacation-requests/services/cancel-request-modal.service';
import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';
import { TimeOffChangesService } from 'src/time-off-logging/services/time-off-changes.service';
import { IVacationRequestChange } from 'src/time-off-logging/types/time-off-change.types';

// The requester's cancel, confirmed from Home, the Time off screen or a DM.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class CancelVacationRequestActionHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  object,
  IVacationRequestChange
> {
  public constructor(
    private readonly timeOffChangesService: TimeOffChangesService,
    private readonly homeTabService: HomeTabService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly cancelRequestModalService: CancelRequestModalService,
  ) {
    super();
  }

  protected onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.timeOffChangesService.cancel(
      { id: meta.id, slackTeamId: user.slack_team_id },
      user,
    );
  }

  // Back to the Time off screen the cancel started on, else Home.
  protected successResponse(
    { billedDates }: IVacationRequestChange,
    user: IUserViewModel,
    meta: IConfirmationModalViewMetadata,
  ): ViewResponseAction {
    const notice = withBilledDays('✅ Vacation request canceled.', billedDates);

    if (meta.pageMetadata !== undefined) {
      this.tabNavigationService.navigate(TabId.TimeOff, {
        user,
        metadata: JSON.parse(meta.pageMetadata || '{}') as unknown,
        notice,
      });
    } else {
      this.homeTabService.publish({ user, notice });
    }

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error canceling vacation request: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      await this.cancelRequestModalService.getModal({
        user,
        requestId: meta.id,
        errorMessage,
        pageMetadata: meta.pageMetadata,
      }),
    );
  }
}
