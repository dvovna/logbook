import { Injectable } from '@nestjs/common';
import { RECEIPT_ADMIN_ROLES } from 'src/receipts/constants/receipt-roles';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  IRejectReceiptFormData,
  RejectReceiptParser,
} from '@modules/slack/tabs/receipts/parsers/reject-receipt.parser';
import { ReceiptsTabService } from '@modules/slack/tabs/receipts/services/receipts-tab.service';
import { IRejectReceiptMetadata } from '@modules/slack/tabs/receipts/views/reject-receipt-modal.view';
import { parsePageMetadata } from '@modules/slack/tabs/receipts/views/receipts-tab.view';
import { IUserViewModel } from '@modules/users/types/user.interface';

// Rejects the receipt; its owner's DM is saved with the rejection (the
// RECEIPT_REJECTED listener).
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.RejectReceiptForm,
  type: 'view_submission',
  allowedRoles: RECEIPT_ADMIN_ROLES,
})
export class RejectReceiptFormSubmitHandler extends BaseModalFormSubmitHandler<
  IRejectReceiptMetadata,
  IRejectReceiptFormData,
  string
> {
  public constructor(
    private readonly receiptsTabService: ReceiptsTabService,
    private readonly tabNavigationService: TabNavigationService,
    parser: RejectReceiptParser,
  ) {
    super(parser);
  }

  protected onSubmit(
    data: IRejectReceiptFormData,
    meta: IRejectReceiptMetadata,
    user: IUserViewModel,
  ) {
    return this.receiptsTabService.reject(
      meta.id,
      data.reason,
      user,
      meta.submittedAt === undefined
        ? undefined
        : { submittedAt: meta.submittedAt },
    );
  }

  protected successResponse(
    notice: string,
    user: IUserViewModel,
    meta: IRejectReceiptMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.Receipts, {
      user,
      metadata: parsePageMetadata(meta.pageMetadata),
      notice,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IRejectReceiptFormData,
    meta: IRejectReceiptMetadata,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.receiptsTabService.getRejectErrorModal({
        user,
        receiptId: meta.id,
        expectedSubmittedAt: meta.submittedAt,
        errorMessage,
        pageMetadata: meta.pageMetadata ?? '',
      }),
    );
  }
}
