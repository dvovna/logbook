import { Injectable, Logger } from '@nestjs/common';
import { ALL_ROLES } from '@common/constants/role-groups';
import { getDateOnly } from '@common/utils/date.utils';
import { runInBackground } from '@common/utils/run-in-background';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import {
  IReceiptDetailsFormData,
  ReceiptDetailsParser,
} from '@modules/slack/receipts/parsers/receipt-details.parser';
import {
  IReceiptDetailsMetadata,
  ReceiptDetailsModalView,
} from '@modules/slack/receipts/views/receipt-details-modal.view';
import { ReceivedReceiptMessageView } from '@modules/slack/receipts/views/received-receipt-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReceiptDetailsForm,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class ReceiptDetailsSubmitHandler extends BaseModalFormSubmitHandler<
  IReceiptDetailsMetadata,
  IReceiptDetailsFormData,
  IReceiptViewModel
> {
  private readonly receiptLogger = new Logger(ReceiptDetailsSubmitHandler.name);

  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly modalView: ReceiptDetailsModalView,
    private readonly messageView: ReceivedReceiptMessageView,
    private readonly tabNavigationService: TabNavigationService,
    parser: ReceiptDetailsParser,
  ) {
    super(parser);
  }

  protected onSubmit(
    data: IReceiptDetailsFormData,
    metadata: IReceiptDetailsMetadata,
    user: IUserViewModel,
  ) {
    return this.receipts.saveDetails(
      metadata.receiptId,
      {
        reimbursementId: data.reimbursement.value,
        month: data.month.value,
        amountCents: data.amount,
        comment: data.comment ?? null,
      },
      user,
    );
  }

  protected successResponse(
    receipt: IReceiptViewModel,
    user: IUserViewModel,
    { channel, ts, pageMetadata }: IReceiptDetailsMetadata,
  ) {
    if (channel && ts) {
      runInBackground(this.receiptLogger, 'replace the receipt message', () =>
        this.showSent(receipt, user, channel, ts),
      );
    } else if (pageMetadata !== undefined) {
      // Opened from My receipts.
      this.tabNavigationService.navigate(TabId.MyReceipts, {
        user,
        notice: '✅ Receipt sent to Finance.',
      });
    }

    return SlackViewResponseFactory.success();
  }

  private async showSent(
    receipt: IReceiptViewModel,
    user: IUserViewModel,
    channel: string,
    ts: string,
  ) {
    const [reimbursement, currency] = await Promise.all([
      this.reimbursements.findById(
        receipt.reimbursementId as string,
        user.slack_team_id,
      ),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    if (!reimbursement) {
      return;
    }

    await this.slackCommunicationService.updateMessage(
      channel,
      ts,
      this.messageView.sent(receipt, reimbursement, currency),
      user.slack_team_id,
    );
  }

  // The form again, with what went wrong under it; where the receipt can't
  // be shown (not the person's, gone) only the message.
  protected async errorResponse(
    errorMessage: string,
    _data: IReceiptDetailsFormData,
    metadata: IReceiptDetailsMetadata,
    user: IUserViewModel,
  ) {
    try {
      const [receipt, reimbursements, currency] = await Promise.all([
        this.receipts.findOwnById(metadata.receiptId, user),
        this.reimbursements.findActive(user.slack_team_id),
        this.slackTeamsService.getCurrency(user.slack_team_id),
      ]);

      return SlackViewResponseFactory.update(
        this.modalView.build(
          {
            receipt,
            reimbursements,
            today: getDateOnly(new Date()),
            currency,
            errorMessage,
          },
          metadata,
        ),
      );
    } catch {
      return SlackViewResponseFactory.update(
        this.modalView.getErrorView('Receipt details', errorMessage),
      );
    }
  }
}
