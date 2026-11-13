import { Injectable } from '@nestjs/common';
import { ActionsBlockElement, AnyBlock, Button } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { formatDayMonth } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import PaginationView from '@modules/slack/common/views/components/pagination.view';
import { clip } from '@modules/slack/common/views/components/message-sections';
import {
  detail,
  ListItem,
} from '@modules/slack/common/views/components/list-item.view';
import { Divider } from '@modules/slack/common/views/components/separator';
import {
  RECEIPT_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import {
  IReceiptsMonth,
  IReceiptsMonthPerson,
  IReceiptsMonthReceipt,
} from 'src/receipts/types/receipts-month.interface';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import { addMonths, monthLabel } from 'src/receipts/utils/receipt-months';

export interface IReceiptsTabMetadata {
  reimbursementId?: string;
  // The first day of the month shown.
  month?: string;
  page?: number;
  // The child screen, Reimbursements.
  reimbursements?: boolean;
}

// What a form opened from the screen hands back (pageMetadata): only the
// keys the screen knows, whatever the string holds.
export const parsePageMetadata = (
  pageMetadata?: string,
): IReceiptsTabMetadata => {
  try {
    const { reimbursementId, month, page, reimbursements } = JSON.parse(
      pageMetadata || '{}',
    );

    return {
      ...(typeof reimbursementId === 'string' ? { reimbursementId } : {}),
      ...(typeof month === 'string' ? { month } : {}),
      ...(typeof page === 'number' ? { page } : {}),
      ...(reimbursements === true ? { reimbursements } : {}),
    };
  } catch {
    return {};
  }
};

export const PEOPLE_PAGE_SIZE = 10;

// Slack takes 100 blocks in a view. The header, the month's line, the
// pagination and the buttons take about 16 of them; a person takes a heading
// and a line for what is not shown, and a receipt three (the item, its
// buttons and the divider).
const PAGE_BLOCKS = 100 - 16;

// How many receipts each person of a page shows, so that the page fits: the
// people with the most come first, so what is left out is the decided ones.
export const receiptsShownPerPerson = (peopleOnPage: number) =>
  Math.max(1, Math.floor((PAGE_BLOCKS / Math.max(peopleOnPage, 1) - 2) / 3));

// Slack's limit for the text of an option, and a file name this long is a
// title.
const MAX_OPTION_CHARACTERS = 75;
const MAX_FILE_NAME_CHARACTERS = 100;
// The names "Sent nothing" lists.
const MAX_NAMES_LISTED = 15;

interface IGetViewParams extends IBaseTabViewParams {
  // The active ones, to choose from.
  reimbursements: IReimbursementViewModel[];
  overview: IReceiptsMonth | null;
  currency: string;
  page: number;
}

const text = (value: string): AnyBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text: value },
});

const button = (
  label: string,
  actionId: ReceiptsTabActionId,
  value?: string,
  style?: 'primary' | 'danger',
): Button => ({
  type: 'button',
  text: { type: 'plain_text', text: label, emoji: true },
  action_id: actionId,
  ...(value === undefined ? {} : { value }),
  ...(style ? { style } : {}),
});

// A month of one reimbursement for Admin and Finance: who sent what, with
// the decisions, and who sent nothing.
@Injectable()
export class ReceiptsTabView extends BaseTabView<
  IGetViewParams,
  IReceiptsTabMetadata
> {
  protected callbackId = ViewCallbackId.ReceiptsTabView;

  protected getTabTitle({ overview }: IGetViewParams): string {
    const title = `*${SCREENS[ScreenId.Receipts].title}*`;

    return overview
      ? `${title} · ${escapeMrkdwn(overview.reimbursement.name)} · ${monthLabel(overview.month)}`
      : title;
  }

  protected getContentBlocks({
    reimbursements,
    overview,
    currency,
    page,
  }: IGetViewParams): AnyBlock[] {
    if (!overview) {
      return [
        text(
          'There are no reimbursements yet. Add one to start collecting receipts.',
        ),
        this.getButtonsBlock(),
      ];
    }

    const people = overview.people.slice(
      (page - 1) * PEOPLE_PAGE_SIZE,
      page * PEOPLE_PAGE_SIZE,
    );
    const lastPage = page * PEOPLE_PAGE_SIZE >= overview.people.length;

    return [
      this.getMonthRow(overview, reimbursements),
      text(this.getSummary(overview)),
      ...(overview.people.length
        ? people.flatMap((person) =>
            this.getPersonBlocks(
              person,
              overview.reimbursement,
              currency,
              receiptsShownPerPerson(people.length),
            ),
          )
        : [text('_No receipts for this month yet._')]),
      ...PaginationView.getBlocks({
        page,
        pageSize: PEOPLE_PAGE_SIZE,
        totalCount: overview.people.length,
        prevPageActionId: ReceiptsTabActionId.PaginationPrev,
        nextPageActionId: ReceiptsTabActionId.PaginationNext,
      }),
      ...(lastPage && overview.sentNothing.length
        ? [text(this.getSentNothing(overview.sentNothing))]
        : []),
      ...Divider.getBlocks(),
      this.getButtonsBlock(),
    ];
  }

  private getMonthRow(
    { reimbursement, month }: IReceiptsMonth,
    reimbursements: IReimbursementViewModel[],
  ): AnyBlock {
    const elements: ActionsBlockElement[] = [
      button(
        '◀ Previous month',
        ReceiptsTabActionId.PreviousMonth,
        addMonths(month, -1),
      ),
      button(
        'Next month ▶',
        ReceiptsTabActionId.NextMonth,
        addMonths(month, 1),
      ),
    ];

    if (reimbursements.length > 1) {
      const options = reimbursements.map(({ id, name }) =>
        toPlainTextOption({ id, name: clip(name, MAX_OPTION_CHARACTERS) }),
      );

      elements.push({
        type: 'static_select',
        action_id: ReceiptsTabActionId.SelectReimbursement,
        placeholder: { type: 'plain_text', text: 'Reimbursement' },
        options,
        initial_option: options.find(({ value }) => value === reimbursement.id),
      });
    }

    return { type: 'actions', elements };
  }

  // "14 of 22 people sent receipts · 3 waiting · due 4 Nov"
  private getSummary({
    people,
    sentNothing,
    waiting,
    dueDate,
  }: IReceiptsMonth) {
    const sent = people.filter(({ receipts }) =>
      receipts.some(
        ({ status }) =>
          status === ReceiptStatus.Submitted ||
          status === ReceiptStatus.Accepted,
      ),
    ).length;

    return `${sent} of ${sent + sentNothing.length} people sent receipts · ${waiting} waiting · due ${formatDayMonth(dueDate)}`;
  }

  private getSentNothing(people: IReceiptsMonth['sentNothing']) {
    const names = people
      .slice(0, MAX_NAMES_LISTED)
      .map(({ name }) => escapeMrkdwn(name));
    const more = people.length - names.length;

    return `Sent nothing: ${names.join(', ')}${more > 0 ? `, …and ${more} more` : ''}`;
  }

  private getPersonBlocks(
    person: IReceiptsMonthPerson,
    reimbursement: IReimbursementViewModel,
    currency: string,
    shown: number,
  ): AnyBlock[] {
    const { limitCents } = reimbursement;
    const total = formatMoney(
      person.acceptedCents + person.submittedCents,
      currency,
    );
    // What waits for a decision first: it is what the screen is for.
    const receipts = [
      ...person.receipts.filter(
        ({ status }) => status === ReceiptStatus.Submitted,
      ),
      ...person.receipts.filter(
        ({ status }) => status !== ReceiptStatus.Submitted,
      ),
    ];
    const hidden = receipts.length - shown;

    return [
      text(
        `*${escapeMrkdwn(person.name)}*${person.active ? '' : ' (deactivated)'} · ${total}${limitCents === null ? '' : ` of ${formatMoney(limitCents, currency)}`}${person.overLimit ? ' ⚠️ over the limit' : ''}`,
      ),
      ...receipts
        .slice(0, shown)
        .flatMap((receipt) => this.getReceiptBlocks(receipt, currency)),
      ...(hidden > 0
        ? [
            {
              type: 'context' as const,
              elements: [
                {
                  type: 'mrkdwn' as const,
                  text: `…and ${hidden} more ${hidden === 1 ? 'receipt' : 'receipts'}`,
                },
              ],
            },
          ]
        : []),
    ];
  }

  private getReceiptBlocks(
    receipt: IReceiptsMonthReceipt,
    currency: string,
  ): AnyBlock[] {
    const waiting = receipt.status === ReceiptStatus.Submitted;
    const line = [
      detail(
        'Amount',
        receipt.amountCents === null
          ? null
          : formatMoney(receipt.amountCents, currency),
      ),
      detail('Status', withIcon(RECEIPT_STATUS_LABELS[receipt.status])),
    ]
      .filter(Boolean)
      .join(' · ');

    return ListItem.getBlocks({
      title: clip(receipt.fileName, MAX_FILE_NAME_CHARACTERS),
      details: [
        line,
        receipt.late && '⏰ Late',
        receipt.alsoSentBy.length > 0 &&
          `Same file as ${receipt.alsoSentBy.map(escapeMrkdwn).join(', ')}`,
        detail('Comment', receipt.comment && escapeMrkdwn(receipt.comment)),
        detail(
          'Reason',
          receipt.rejectionReason && escapeMrkdwn(receipt.rejectionReason),
        ),
      ],
      ...(waiting
        ? {
            buttons: [
              button(
                'Accept',
                ReceiptsTabActionId.AcceptReceipt,
                receipt.id,
                'primary',
              ),
              button(
                'Reject',
                ReceiptsTabActionId.RejectReceipt,
                receipt.id,
                'danger',
              ),
            ],
          }
        : { accessory: this.getDecidedMenu(receipt) }),
    });
  }

  // The opposite decision: one option, which ListItem shows as a button.
  private getDecidedMenu({
    id,
    status,
  }: IReceiptsMonthReceipt): SectionBlockAccessory {
    const accepted = status === ReceiptStatus.Accepted;
    const action = accepted
      ? ReceiptsTabActionId.RejectReceipt
      : ReceiptsTabActionId.AcceptReceipt;

    return {
      type: 'overflow',
      action_id: ReceiptsTabActionId.ManageReceiptMenu,
      options: [
        {
          text: { type: 'plain_text', text: accepted ? 'Reject' : 'Accept' },
          value: `${action}:${id}`,
        },
      ],
    };
  }

  private getButtonsBlock(): AnyBlock {
    return {
      type: 'actions',
      elements: [
        button('⚙️ Reimbursements', ReceiptsTabActionId.OpenReimbursements),
      ],
    };
  }
}
