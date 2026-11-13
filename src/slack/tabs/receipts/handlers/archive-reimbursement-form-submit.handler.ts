import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { RECEIPT_ADMIN_ROLES } from 'src/receipts/constants/receipt-roles';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IConfirmationModalViewMetadata } from '@modules/slack/common/views/components/confirmation-modal.view';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { ReceiptsModalName } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { ReceiptsTabService } from '@modules/slack/tabs/receipts/services/receipts-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ArchiveReimbursementForm,
  type: 'view_submission',
  allowedRoles: RECEIPT_ADMIN_ROLES,
})
export class ArchiveReimbursementFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  never,
  IReimbursementViewModel
> {
  public constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly receiptsTabService: ReceiptsTabService,
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected onSubmit(
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.reimbursements.archive(meta.id, user);
  }

  protected successResponse(
    reimbursement: IReimbursementViewModel,
    user: IUserViewModel,
  ): ViewResponseAction {
    this.tabNavigationService.navigate(TabId.Receipts, {
      user,
      metadata: { reimbursements: true },
      notice: `✅ Reimbursement ${reimbursement.name} archived.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    try {
      return SlackViewResponseFactory.update(
        await this.receiptsTabService.getModalView(
          ReceiptsModalName.ArchiveReimbursement,
          {
            user,
            reimbursementId: meta.id,
            errorMessage,
            pageMetadata: meta.pageMetadata ?? '',
          },
        ),
      );
    } catch {
      return SlackViewResponseFactory.update(
        this.receiptsTabService.getReimbursementErrorView(errorMessage),
      );
    }
  }
}
