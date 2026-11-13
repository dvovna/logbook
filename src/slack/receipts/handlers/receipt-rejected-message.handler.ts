import { Injectable, Logger } from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { ALL_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { ReceiptDetailsModalView } from '@modules/slack/receipts/views/receipt-details-modal.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';

// The button of the DM about a rejected receipt. Ownership is checked by
// ReceiptsService: the receipt ID in the button's value comes from the
// client.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReceiptRejectedMessage,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class ReceiptRejectedMessageHandler extends BaseActionHandler {
  private readonly logger = new Logger(ReceiptRejectedMessageHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly detailsModalView: ReceiptDetailsModalView,
  ) {
    super();

    this.actionMap = {
      [ReceiptActionId.EditDetails]: (payload, user) =>
        this.refusing(user, () => this.openDetails(payload, user)),
    };
  }

  // The details form; after its save the DM is replaced, as the DM of a
  // receipt that waited for its details is.
  private async openDetails(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const receipt = await this.receipts.findOwnById(
      (payload.actions[0] as ButtonAction).value ?? '',
      user,
    );

    if (receipt.status === ReceiptStatus.Accepted) {
      throw new ValidationError('An accepted receipt can’t be changed.');
    }

    const [reimbursements, currency] = await Promise.all([
      this.reimbursements.findActive(user.slack_team_id),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    if (!reimbursements.length) {
      throw new ValidationError(
        'There are no reimbursements to send receipts for yet.',
      );
    }

    await this.slackCommunicationService.openView(
      payload.trigger_id,
      this.detailsModalView.build(
        { receipt, reimbursements, today: getDateOnly(new Date()), currency },
        {
          receiptId: receipt.id,
          channel: payload.channel?.id,
          ts: payload.message?.ts,
        },
      ),
      user.slack_team_id,
    );
  }

  // A refusal or a missing receipt is told to the clicker; a receipt that
  // is not theirs only logged, as for the other buttons in messages.
  private async refusing(user: IUserViewModel, action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      switch (classifyActionError(error)) {
        case 'refusal':
          return this.tell(user, (error as Error).message);
        case 'not-found':
          return this.tell(user, 'This receipt no longer exists.');
        case 'forbidden':
          this.logger.warn(
            `Receipt action refused: ${(error as Error).message}`,
          );

          return;
        default:
          throw error;
      }
    }
  }

  private tell(user: IUserViewModel, text: string) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text },
      user.slack_team_id,
    );
  }
}
