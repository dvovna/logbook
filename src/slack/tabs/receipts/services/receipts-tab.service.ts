import { Injectable, NotFoundException } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import {
  ReceiptFilesDmService,
  FILE_DELETED,
} from '@modules/slack/receipts/services/receipt-files-dm.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptsModalName } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { IReimbursementFormData } from '@modules/slack/tabs/receipts/parsers/reimbursement-modal.parser';
import { ReimbursementModalView } from '@modules/slack/tabs/receipts/views/reimbursement-modal.view';
import { RejectReceiptModalView } from '@modules/slack/tabs/receipts/views/reject-receipt-modal.view';
import { IDecisionValue } from '@modules/slack/tabs/receipts/utils/receipt-decision-value';
import {
  IReceiptsTabMetadata,
  PEOPLE_PAGE_SIZE,
  RECEIPTS_PAGE_SIZE,
  ReceiptsTabView,
} from '@modules/slack/tabs/receipts/views/receipts-tab.view';
import { ReimbursementsView } from '@modules/slack/tabs/receipts/views/reimbursements.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { assertCanManageReceipts } from 'src/receipts/constants/receipt-roles';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import { ReceiptChangedError } from 'src/receipts/errors/receipt-changed.error';
import {
  IExpectedReceipt,
  ReceiptDecisionsService,
} from 'src/receipts/services/receipt-decisions.service';
import { ReceiptsMonthService } from 'src/receipts/services/receipts-month.service';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';
import {
  collectedMonth,
  isMonthStart,
} from 'src/receipts/utils/receipt-months';

export interface IReceiptsModalParams extends IOpenModalBaseParams<string> {
  receiptId?: string;
  // When the receipt was sent as the screen showed it.
  expectedSubmittedAt?: string;
  reimbursementId?: string;
  // What the form is filled with again after an error: what was typed.
  typed?: IReimbursementFormData;
}

type ReceiptsModalResolversMap = {
  [key in ReceiptsModalName]: (params: IReceiptsModalParams) => Promise<View>;
};

@Injectable()
export class ReceiptsTabService extends BaseTabService<
  ReceiptsModalResolversMap,
  IPublishBaseParams<IReceiptsTabMetadata>
> {
  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly decisions: ReceiptDecisionsService,
    private readonly months: ReceiptsMonthService,
    private readonly reimbursements: ReimbursementsService,
    private readonly users: UsersService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly tabView: ReceiptsTabView,
    private readonly reimbursementsView: ReimbursementsView,
    private readonly rejectModalView: RejectReceiptModalView,
    private readonly reimbursementModalView: ReimbursementModalView,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly filesDm: ReceiptFilesDmService,
  ) {
    super(TabId.Receipts, {
      [ReceiptsModalName.RejectReceipt]: (params) =>
        this.getRejectModal(params),
      [ReceiptsModalName.AddReimbursement]: (params) =>
        this.getReimbursementModal(params),
      [ReceiptsModalName.EditReimbursement]: (params) =>
        this.getReimbursementModal(params),
      [ReceiptsModalName.ArchiveReimbursement]: (params) =>
        this.getArchiveModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
  }: IPublishBaseParams<IReceiptsTabMetadata>) {
    const [{ active, archived }, currency] = await Promise.all([
      metadata.reimbursements
        ? this.reimbursements
            .findActive(user.slack_team_id)
            .then((found) => ({ active: found, archived: [] }))
        : this.reimbursements.findShownToFinance(user.slack_team_id),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);
    const base = { userId: user.slack_id, userRole: user.role };

    if (metadata.reimbursements) {
      return this.reimbursementsView.getView(
        { ...base, reimbursements: active, currency },
        { reimbursements: true },
      );
    }

    // Archived ones stay while they hold receipts, so that Finance can still
    // decide on and download them. One no longer offered: the first.
    const offered = [...active, ...archived];
    const selected =
      offered.find(({ id }) => id === metadata.reimbursementId) ?? offered[0];

    if (!selected) {
      return this.tabView.getView({
        ...base,
        reimbursements: offered,
        overview: null,
        currency,
        page: 1,
      });
    }

    const month =
      metadata.month && isMonthStart(metadata.month)
        ? metadata.month
        : collectedMonth(getDateOnly(new Date()), selected.dueDay);
    const overview = await this.months.getMonth(
      { reimbursementId: selected.id, month },
      user,
    );
    // A person of this month's overview, whatever the client sent.
    const person = metadata.userId
      ? overview.people.find(({ userId }) => userId === metadata.userId)
      : undefined;
    const pages = Math.max(
      Math.ceil(
        (person ? person.receipts.length : overview.people.length) /
          (person ? RECEIPTS_PAGE_SIZE : PEOPLE_PAGE_SIZE),
      ),
      1,
    );
    const page = Math.min(Math.max(metadata.page ?? 1, 1), pages);

    return this.tabView.getView(
      { ...base, reimbursements: offered, overview, currency, page, person },
      {
        reimbursementId: selected.id,
        month,
        page,
        ...(person
          ? { userId: person.userId, fromPage: metadata.fromPage ?? 1 }
          : {}),
      },
    );
  }

  // A receipt sent again since the screen showed it is refused, and the
  // screen shows it as it is now.
  public async accept(
    { receiptId, expected }: IDecisionValue,
    user: IUserViewModel,
    metadata: IReceiptsTabMetadata,
  ) {
    let notice: string;

    try {
      const receipt = await this.decisions.accept(receiptId, user, expected);

      notice = `✅ Accepted ${receipt.fileName} from ${await this.ownerName(receipt)}.`;
    } catch (error) {
      notice = this.refusalNotice(error);
    }

    await this.publish({ user, metadata, notice });
  }

  // Open: the file goes to the viewer's DM as a job. A receipt that is
  // gone or not the workspace's, or a file past retention, is a notice and
  // saves no job.
  public async openFile(
    receiptId: string,
    user: IUserViewModel,
    metadata: IReceiptsTabMetadata,
  ) {
    let notice: string;

    try {
      assertCanManageReceipts(user);

      const receipt = await this.receipts.findById(
        receiptId,
        user.slack_team_id,
      );

      if (!receipt) {
        throw new NotFoundException(`Receipt ${receiptId} not found`);
      }

      if (receipt.status === ReceiptStatus.Draft) {
        throw new ValidationError(
          'This receipt has not been sent for checking yet.',
        );
      }

      const name = escapeMrkdwn(receipt.fileName);

      if (receipt.fileDeletedAt) {
        notice = FILE_DELETED;
      } else {
        notice = (await this.filesDm.startOpen(user, receipt.id))
          ? `📎 Sending ${name} to your Messages.`
          : `📎 ${name} is already on its way to your Messages.`;
      }
    } catch (error) {
      notice = this.refusalNotice(error);
    }

    await this.publish({ user, metadata, notice });
  }

  // Download the month: the screen's month as a ZIP in parts, as a job.
  public async downloadMonth(
    user: IUserViewModel,
    metadata: IReceiptsTabMetadata,
  ) {
    let notice: string;

    try {
      assertCanManageReceipts(user);

      const { reimbursementId, month } = metadata;

      if (!reimbursementId || !month || !isMonthStart(month)) {
        throw new ValidationError('Choose a reimbursement and a month first.');
      }

      const reimbursement = await this.reimbursements.findById(
        reimbursementId,
        user.slack_team_id,
      );

      if (!reimbursement) {
        throw new NotFoundException(
          `Reimbursement ${reimbursementId} not found`,
        );
      }

      notice = (await this.filesDm.startDownload(user, reimbursement.id, month))
        ? '📦 Sending the archive to your Messages.'
        : '📦 The archive is already on its way to your Messages.';
    } catch (error) {
      notice = this.refusalNotice(error);
    }

    await this.publish({ user, metadata, notice });
  }

  // The notice a form that rejects shows on the screen. A receipt sent again
  // since the form was opened closes it with the refusal, and the screen
  // shows the receipt as it is now.
  public async reject(
    receiptId: string,
    reason: string,
    user: IUserViewModel,
    expected?: IExpectedReceipt,
  ): Promise<string> {
    let receipt: IReceiptViewModel;

    try {
      receipt = await this.decisions.reject(receiptId, reason, user, expected);
    } catch (error) {
      if (error instanceof ReceiptChangedError) {
        return `⚠️ ${error.message}`;
      }

      throw error;
    }

    return `❌ Rejected ${receipt.fileName}. ${await this.ownerName(receipt)} gets a message about it.`;
  }

  // A button's refusal (the receipt was decided meanwhile, it is gone) is
  // shown, and the screen is the receipts as they are now.
  private refusalNotice(error: unknown): string {
    switch (classifyActionError(error)) {
      case 'refusal':
      case 'forbidden':
        return `⚠️ ${(error as Error).message}`;
      case 'not-found':
        return '⚠️ This receipt no longer exists.';
      default:
        throw error;
    }
  }

  private async ownerName({ userId, slackTeamId }: IReceiptViewModel) {
    const owner = await this.users.findOne({
      id: userId,
      slackTeamId,
      includeInactive: true,
    });

    return owner ? personLabel(owner) : 'Its owner';
  }

  // The reject form again with the error; where the receipt can't be shown
  // (gone, not the workspace's), only the error.
  public async getRejectErrorModal(params: IReceiptsModalParams) {
    try {
      return await this.getModalView(ReceiptsModalName.RejectReceipt, params);
    } catch {
      return this.rejectModalView.getErrorView(
        'Reject receipt',
        params.errorMessage ?? 'This receipt is not available.',
      );
    }
  }

  public getReimbursementErrorView(errorMessage: string): View {
    return this.reimbursementModalView.getErrorView(
      'Archive reimbursement',
      errorMessage,
    );
  }

  private async getRejectModal({
    user,
    receiptId,
    expectedSubmittedAt,
    pageMetadata,
    errorMessage,
  }: IReceiptsModalParams) {
    assertCanManageReceipts(user);

    const receipt = await this.receipts.findById(
      receiptId ?? '',
      user.slack_team_id,
    );

    if (!receipt) {
      throw new NotFoundException(`Receipt ${receiptId} not found`);
    }

    if (receipt.status === ReceiptStatus.Draft) {
      throw new ValidationError(
        'This receipt has not been sent for checking yet.',
      );
    }

    const [currency, ownerName] = await Promise.all([
      this.slackTeamsService.getCurrency(user.slack_team_id),
      this.ownerName(receipt),
    ]);

    return this.rejectModalView.getView(
      {
        fileName: receipt.fileName,
        ownerName,
        amount:
          receipt.amountCents === null
            ? null
            : formatMoney(receipt.amountCents, currency),
        errorMessage,
      },
      { id: receipt.id, submittedAt: expectedSubmittedAt, pageMetadata },
    );
  }

  private async getReimbursementModal({
    user,
    reimbursementId,
    pageMetadata,
    errorMessage,
    typed,
  }: IReceiptsModalParams) {
    assertCanManageReceipts(user);

    const [currency, existing] = await Promise.all([
      this.slackTeamsService.getCurrency(user.slack_team_id),
      reimbursementId
        ? this.findActiveOne(reimbursementId, user.slack_team_id)
        : null,
    ]);
    const initial = typed
      ? { name: typed.name, dueDay: typed.dueDay, limitCents: typed.limit }
      : existing && {
          name: existing.name,
          dueDay: existing.dueDay,
          limitCents: existing.limitCents,
        };

    return this.reimbursementModalView.getView(
      { editing: Boolean(reimbursementId), currency, ...initial, errorMessage },
      { id: reimbursementId, pageMetadata },
    );
  }

  private async getArchiveModal({
    user,
    reimbursementId,
    pageMetadata,
    errorMessage,
  }: IReceiptsModalParams) {
    assertCanManageReceipts(user);

    const reimbursement = await this.findActiveOne(
      reimbursementId ?? '',
      user.slack_team_id,
    );

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ArchiveReimbursementForm,
        title: 'Archive reimbursement',
        confirmText: 'Archive',
        message: `*${escapeMrkdwn(reimbursement.name)}* will be archived: people can no longer send receipts for it, and its receipts stay.`,
        errorMessage,
      },
      { id: reimbursement.id, pageMetadata },
    );
  }

  private async findActiveOne(id: string, slackTeamId: string) {
    const active = await this.reimbursements.findActive(slackTeamId);
    const found = active.find((item) => item.id === id);

    if (!found) {
      throw new NotFoundException(`Reimbursement ${id} not found`);
    }

    return found;
  }
}
