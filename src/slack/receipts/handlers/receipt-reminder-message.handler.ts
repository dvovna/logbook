import { Injectable, Logger } from '@nestjs/common';
import type { ButtonAction } from '@slack/bolt';
import { ALL_ROLES } from '@common/constants/role-groups';
import { runInBackground } from '@common/utils/run-in-background';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import {
  parseOpenValue,
  ReceiptReminderMessageView,
} from '@modules/slack/receipts/views/receipt-reminder-message.view';
import { IReceiptMessage } from '@modules/slack/receipts/views/received-receipt-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { assertCanManageReceipts } from 'src/receipts/constants/receipt-roles';
import { ReimbursementOptOutsService } from 'src/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';

// The buttons of the reminders: "I don't use this" is anyone's, for
// themselves; "Open receipts" is Finance's and Admin's, which the handler
// checks itself. A button's value and who clicks it come from the client:
// the services the reimbursement goes to check it is the workspace's.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReceiptReminderMessage,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
export class ReceiptReminderMessageHandler extends BaseActionHandler {
  private readonly logger = new Logger(ReceiptReminderMessageHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly view: ReceiptReminderMessageView,
  ) {
    super();

    this.actionMap = {
      [ReceiptActionId.NoReminders]: (payload, user) =>
        this.refusing(user, () => this.optOut(payload, user)),
      [ReceiptActionId.OpenReceipts]: (payload, user) =>
        this.refusing(user, () => this.openReceipts(payload, user)),
    };
  }

  private valueOf(payload: ISlackBlockActionPayload) {
    return (payload.actions[0] as ButtonAction).value ?? '';
  }

  private async optOut(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const reimbursementId = this.valueOf(payload);

    await this.optOuts.optOut(user, reimbursementId);

    const reimbursement = await this.reimbursements.findById(
      reimbursementId,
      user.slack_team_id,
    );

    this.replaceMessage(
      payload,
      user,
      this.view.optedOut(reimbursement?.name ?? 'this'),
    );
  }

  private openReceipts(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    assertCanManageReceipts(user);

    const { reimbursementId, month } = parseOpenValue(this.valueOf(payload));

    // The screen falls back to its first reimbursement and the month being
    // collected for an ID or a month it doesn't know.
    this.tabNavigationService.navigate(TabId.Receipts, {
      user,
      metadata: { reimbursementId, month },
    });

    this.replaceMessage(
      payload,
      user,
      this.view.summaryOpened(payload.message?.text ?? ''),
    );
  }

  private replaceMessage(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
    message: IReceiptMessage,
  ) {
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;

    if (!channel || !ts) {
      return;
    }

    runInBackground(this.logger, 'replace the reminder message', () =>
      this.slackCommunicationService.updateMessage(
        channel,
        ts,
        message,
        user.slack_team_id,
      ),
    );
  }

  private async refusing(user: IUserViewModel, action: () => unknown) {
    try {
      await action();
    } catch (error) {
      switch (classifyActionError(error)) {
        case 'refusal':
          return this.tell(user, (error as Error).message);
        case 'not-found':
          return this.tell(user, 'This reimbursement no longer exists.');
        case 'forbidden':
          return this.tell(
            user,
            'Only an admin or finance can open the receipts.',
          );
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
