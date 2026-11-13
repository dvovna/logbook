import { Injectable, Logger } from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { getSelectActionValue } from '@modules/slack/common/utils/payload.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import {
  ReceiptsModalName,
  ReceiptsTabActionId,
} from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { ReceiptsTabService } from '@modules/slack/tabs/receipts/services/receipts-tab.service';
import { IReceiptsTabMetadata } from '@modules/slack/tabs/receipts/views/receipts-tab.view';

// The receipt and reimbursement IDs come from buttons and menus, so from the
// client: the services check that they are the workspace's, and the role.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReceiptsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Receipts),
})
export class ReceiptsTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;
  private readonly logger = new Logger(ReceiptsTabActionHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly receiptsTabService: ReceiptsTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [ReceiptsTabActionId.AcceptReceipt]: (payload, user) =>
        this.accept(this.valueOf(payload), payload, user),
      [ReceiptsTabActionId.RejectReceipt]: (payload, user) =>
        this.openReject(this.valueOf(payload), payload, user),
      [ReceiptsTabActionId.ManageReceiptMenu]: withMenuAction<
        ReceiptsTabActionId,
        [IUserViewModel]
      >(this.handleReceiptMenu, this.logger),
      [ReceiptsTabActionId.PreviousMonth]: (payload, user) =>
        this.showMonth(payload, user),
      [ReceiptsTabActionId.NextMonth]: (payload, user) =>
        this.showMonth(payload, user),
      [ReceiptsTabActionId.SelectReimbursement]: (payload, user) =>
        this.updateTab(
          {
            reimbursementId: getSelectActionValue(payload)?.id,
            page: 1,
          },
          user,
        ),
      [ReceiptsTabActionId.ShowPerson]: (payload, user) => {
        const metadata = parseMetadata<IReceiptsTabMetadata>(payload);

        return this.updateTab(
          {
            ...metadata,
            userId: this.valueOf(payload),
            fromPage: metadata.page ?? 1,
            page: 1,
          },
          user,
        );
      },
      [ReceiptsTabActionId.AllPeople]: (payload, user) => {
        const { userId, fromPage, ...metadata } =
          parseMetadata<IReceiptsTabMetadata>(payload);

        return this.updateTab({ ...metadata, page: fromPage ?? 1 }, user);
      },
      [ReceiptsTabActionId.PaginationPrev]: paginationHandler,
      [ReceiptsTabActionId.PaginationNext]: paginationHandler,

      [ReceiptsTabActionId.OpenReimbursements]: (_payload, user) =>
        this.updateTab({ reimbursements: true }, user),
      [ReceiptsTabActionId.AddReimbursement]: (payload, user) =>
        this.openModal(ReceiptsModalName.AddReimbursement, {}, payload, user),
      [ReceiptsTabActionId.ManageReimbursementMenu]: withMenuAction<
        ReceiptsTabActionId,
        [IUserViewModel]
      >(this.handleReimbursementMenu, this.logger),
    };
  }

  private valueOf(payload: ISlackBlockActionPayload) {
    return (payload.actions[0] as ButtonAction).value ?? '';
  }

  private updateTab = async (
    metadata: IReceiptsTabMetadata,
    user: IUserViewModel,
  ) => {
    await this.receiptsTabService.publish({ user, metadata });
  };

  // The month a Previous or Next button names; the service takes only a real
  // month, and the first of the reimbursement's otherwise.
  private showMonth(payload: ISlackBlockActionPayload, user: IUserViewModel) {
    return this.updateTab(
      {
        ...parseMetadata<IReceiptsTabMetadata>(payload),
        month: this.valueOf(payload),
        page: 1,
      },
      user,
    );
  }

  private accept(
    receiptId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    return this.receiptsTabService.accept(
      receiptId,
      user,
      parseMetadata<IReceiptsTabMetadata>(payload),
    );
  }

  private openReject(
    receiptId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    return this.openModal(
      ReceiptsModalName.RejectReceipt,
      { receiptId },
      payload,
      user,
    );
  }

  private handleReceiptMenu = async (
    actionType: ReceiptsTabActionId,
    receiptId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case ReceiptsTabActionId.AcceptReceipt:
        return this.accept(receiptId, payload, user);
      case ReceiptsTabActionId.RejectReceipt:
        return this.openReject(receiptId, payload, user);
      default:
        this.logger.warn(`Unhandled receipt menu action: ${actionType}`);
    }
  };

  private handleReimbursementMenu = async (
    actionType: ReceiptsTabActionId,
    reimbursementId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case ReceiptsTabActionId.EditReimbursement:
        return this.openModal(
          ReceiptsModalName.EditReimbursement,
          { reimbursementId },
          payload,
          user,
        );
      case ReceiptsTabActionId.ArchiveReimbursement:
        return this.openModal(
          ReceiptsModalName.ArchiveReimbursement,
          { reimbursementId },
          payload,
          user,
        );
      default:
        this.logger.warn(`Unhandled reimbursement menu action: ${actionType}`);
    }
  };

  private async openModal(
    modalName: ReceiptsModalName,
    ids: { receiptId?: string; reimbursementId?: string },
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    await this.receiptsTabService.openModal(
      payload.trigger_id || user.slack_id,
      modalName,
      { user, ...ids, pageMetadata: payload.view.private_metadata },
    );
  }
}
