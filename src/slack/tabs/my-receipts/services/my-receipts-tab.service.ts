import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptDetailsModalView } from '@modules/slack/receipts/views/receipt-details-modal.view';
import { MyReceiptsModalName } from '@modules/slack/tabs/my-receipts/enums/my-receipts-action-id.enum';
import {
  MAX_SHOWN_RECEIPTS,
  MyReceiptsTabView,
} from '@modules/slack/tabs/my-receipts/views/my-receipts-tab.view';

export interface IReceiptModalParams extends IOpenModalBaseParams<string> {
  receiptId: string;
}

type MyReceiptsModalResolversMap = {
  [key in MyReceiptsModalName]: (params: IReceiptModalParams) => Promise<View>;
};

@Injectable()
export class MyReceiptsTabService extends BaseTabService<MyReceiptsModalResolversMap> {
  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly tabView: MyReceiptsTabView,
    private readonly detailsModalView: ReceiptDetailsModalView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.MyReceipts, {
      [MyReceiptsModalName.Edit]: (params) => this.getEditModal(params),
      [MyReceiptsModalName.Delete]: (params) => this.getDeleteModal(params),
    });
  }

  protected async getTabView({ user }: IPublishBaseParams) {
    const [receipts, reimbursements, currency] = await Promise.all([
      this.receipts.findOwn(user),
      this.reimbursements.findAll(user.slack_team_id),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    return this.tabView.getView({
      userId: user.slack_id,
      userRole: user.role,
      receipts: receipts.slice(0, MAX_SHOWN_RECEIPTS),
      hiddenCount: Math.max(receipts.length - MAX_SHOWN_RECEIPTS, 0),
      reimbursementNames: new Map(
        reimbursements.map(({ id, name }) => [id, name]),
      ),
      currency,
    });
  }

  // The delete form again with the error; when the receipt can't be shown
  // (not the person's, gone), only the error.
  public async getDeleteErrorModal(params: IReceiptModalParams): Promise<View> {
    try {
      return await this.getModalView(MyReceiptsModalName.Delete, params);
    } catch {
      return this.confirmationModalView.getView(
        {
          callbackId: ViewCallbackId.DeleteReceiptForm,
          title: 'Delete receipt',
          message: `:warning: ${params.errorMessage}`,
        },
        { id: params.receiptId, pageMetadata: params.pageMetadata },
      );
    }
  }

  private async getEditModal({
    user,
    receiptId,
    pageMetadata,
    errorMessage,
  }: IReceiptModalParams) {
    const [receipt, active, currency] = await Promise.all([
      this.receipts.findOwnById(receiptId, user),
      this.reimbursements.findActive(user.slack_team_id),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    if (receipt.status === ReceiptStatus.Accepted) {
      throw new ValidationError('An accepted receipt can’t be changed.');
    }

    return this.detailsModalView.build(
      {
        receipt,
        reimbursements: active,
        today: getDateOnly(new Date()),
        currency,
        errorMessage,
      },
      { receiptId: receipt.id, pageMetadata },
    );
  }

  private async getDeleteModal({
    user,
    receiptId,
    pageMetadata,
    errorMessage,
  }: IReceiptModalParams) {
    const receipt = await this.receipts.findOwnById(receiptId, user);

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteReceiptForm,
        title: 'Delete receipt',
        confirmText: 'Delete',
        message: `The receipt *${escapeMrkdwn(receipt.fileName)}* and its file will be deleted.`,
        errorMessage,
      },
      { id: receipt.id, pageMetadata },
    );
  }
}
