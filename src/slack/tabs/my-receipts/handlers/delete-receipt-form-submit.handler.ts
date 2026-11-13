import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { ALL_ROLES } from '@common/constants/role-groups';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IConfirmationModalViewMetadata } from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { MyReceiptsTabService } from '@modules/slack/tabs/my-receipts/services/my-receipts-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteReceiptForm,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class DeleteReceiptFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  void
> {
  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly myReceiptsTabService: MyReceiptsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<void> {
    await this.receipts.delete(meta.id, user);

    this.tabNavigationService.navigate(TabId.MyReceipts, {
      user,
      notice: '✅ Receipt deleted.',
    });
  }

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    return SlackViewResponseFactory.update(
      await this.myReceiptsTabService.getDeleteErrorModal({
        user,
        receiptId: meta.id,
        errorMessage,
        pageMetadata: meta.pageMetadata ?? '{}',
      }),
    );
  }
}
