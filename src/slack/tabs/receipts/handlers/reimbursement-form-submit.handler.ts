import { Injectable } from '@nestjs/common';
import { RECEIPT_ADMIN_ROLES } from 'src/receipts/constants/receipt-roles';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { ReceiptsModalName } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import {
  IReimbursementFormData,
  ReimbursementModalParser,
} from '@modules/slack/tabs/receipts/parsers/reimbursement-modal.parser';
import { ReceiptsTabService } from '@modules/slack/tabs/receipts/services/receipts-tab.service';
import { IReimbursementModalMetadata } from '@modules/slack/tabs/receipts/views/reimbursement-modal.view';
import { IUserViewModel } from '@modules/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReimbursementForm,
  type: 'view_submission',
  allowedRoles: RECEIPT_ADMIN_ROLES,
})
export class ReimbursementFormSubmitHandler extends BaseModalFormSubmitHandler<
  IReimbursementModalMetadata,
  IReimbursementFormData,
  IReimbursementViewModel
> {
  public constructor(
    private readonly reimbursements: ReimbursementsService,
    private readonly receiptsTabService: ReceiptsTabService,
    private readonly tabNavigationService: TabNavigationService,
    parser: ReimbursementModalParser,
  ) {
    super(parser);
  }

  protected onSubmit(
    data: IReimbursementFormData,
    meta: IReimbursementModalMetadata,
    user: IUserViewModel,
  ) {
    const input = {
      name: data.name,
      dueDay: data.dueDay,
      limitCents: data.limit,
    };

    return meta.id
      ? this.reimbursements.update(meta.id, input, user)
      : this.reimbursements.create(input, user);
  }

  protected successResponse(
    reimbursement: IReimbursementViewModel,
    user: IUserViewModel,
    meta: IReimbursementModalMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.Receipts, {
      user,
      metadata: { reimbursements: true },
      notice: `✅ Reimbursement ${reimbursement.name} ${meta.id ? 'updated' : 'added'}.`,
    });

    return SlackViewResponseFactory.success();
  }

  // The form again with what was typed and what went wrong.
  protected async errorResponse(
    errorMessage: string,
    data: IReimbursementFormData,
    meta: IReimbursementModalMetadata,
    user: IUserViewModel,
  ) {
    const name = meta.id
      ? ReceiptsModalName.EditReimbursement
      : ReceiptsModalName.AddReimbursement;

    return SlackViewResponseFactory.update(
      await this.receiptsTabService.getModalView(name, {
        user,
        reimbursementId: meta.id,
        errorMessage,
        pageMetadata: meta.pageMetadata ?? '',
        typed: data,
      }),
    );
  }
}
