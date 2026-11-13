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
  // One person's receipts of the month; `page` then pages their receipts,
  // and `fromPage` is the page of people to return to.
  userId?: string;
  fromPage?: number;
}

// What a form opened from the screen hands back (pageMetadata): only the
// keys the screen knows, whatever the string holds.
export const parsePageMetadata = (
  pageMetadata?: string,
): IReceiptsTabMetadata => {
  try {
    const { reimbursementId, month, page, reimbursements, userId, fromPage } =
      JSON.parse(pageMetadata || '{}');

    return {
      ...(typeof reimbursementId === 'string' ? { reimbursementId } : {}),
      ...(typeof month === 'string' ? { month } : {}),
      ...(typeof page === 'number' ? { page } : {}),
      ...(reimbursements === true ? { reimbursements } : {}),
      ...(typeof userId === 'string' ? { userId } : {}),
      ...(typeof fromPage === 'number' ? { fromPage } : {}),
    };
  } catch {
    return {};
  }
};

export const PEOPLE_PAGE_SIZE = 10;

// Slack takes 100 blocks in a view. The header, the month's line, the
// pagination and the buttons take at most 16 of them; the rest is shared by
// the people of a page: each takes a heading (the "Show all" button is its
// accessory), and each receipt three blocks when it waits (the item, its
// buttons and the divider) and two when decided.
const PAGE_BLOCKS = 100 - 16;
const WAITING_BLOCKS = 3;
const DECIDED_BLOCKS = 2;

// A person's view: the navigation row, a notice, the title, the button back,
// the heading and the pagination take 8 blocks, and 20 receipts at most 3
// each: 68 in all.
export const RECEIPTS_PAGE_SIZE = 20;

// What waits for a decision first: it is what the screen is for.
const orderedReceipts = (person: IReceiptsMonthPerson) => [
  ...person.receipts.filter(({ status }) => status === ReceiptStatus.Submitted),
  ...person.receipts.filter(({ status }) => status !== ReceiptStatus.Submitted),
];

const blocksOfReceipt = ({ status }: IReceiptsMonthReceipt) =>
  status === ReceiptStatus.Submitted ? WAITING_BLOCKS : DECIDED_BLOCKS;

// How many receipts each person of a page shows so that the page fits: one
// each, then one more in turn for as long as the next one fits. Counted from
// the receipts themselves, so a page of few receipts shows them all.
export const receiptsShownPerPerson = (
  people: IReceiptsMonthPerson[],
): number[] => {
  const lists = people.map(orderedReceipts);
  const shown = lists.map(() => 0);
  let left = PAGE_BLOCKS - people.length;
  let added = true;

  while (added) {
    added = false;

    lists.forEach((list, i) => {
      const next = list[shown[i]];

      if (next && (shown[i] === 0 || blocksOfReceipt(next) <= left)) {
        shown[i]++;
        left -= blocksOfReceipt(next);
        added = true;
      }
    });
  }

  return shown;
};

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
  // Set: only this person's receipts, all of them.
  person?: IReceiptsMonthPerson;
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
    person,
  }: IGetViewParams): AnyBlock[] {
    if (!overview) {
      return [
        text(
          'There are no reimbursements yet. Add one to start collecting receipts.',
        ),
        this.getButtonsBlock(),
      ];
    }

    if (person) {
      return this.getPersonView(person, overview.reimbursement, currency, page);
    }

    const people = overview.people.slice(
      (page - 1) * PEOPLE_PAGE_SIZE,
      page * PEOPLE_PAGE_SIZE,
    );
    const shown = receiptsShownPerPerson(people);
    const lastPage = page * PEOPLE_PAGE_SIZE >= overview.people.length;

    return [
      this.getMonthRow(overview, reimbursements),
      text(this.getSummary(overview)),
      ...(overview.people.length
        ? people.flatMap((listed, i) =>
            this.getPersonBlocks(
              listed,
              overview.reimbursement,
              currency,
              shown[i],
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

  private getPersonView(
    person: IReceiptsMonthPerson,
    reimbursement: IReimbursementViewModel,
    currency: string,
    page: number,
  ): AnyBlock[] {
    const receipts = orderedReceipts(person);

    return [
      {
        type: 'actions',
        elements: [button('◀ All people', ReceiptsTabActionId.AllPeople)],
      },
      this.getPersonHeading(person, reimbursement, currency),
      ...receipts
        .slice((page - 1) * RECEIPTS_PAGE_SIZE, page * RECEIPTS_PAGE_SIZE)
        .flatMap((receipt) => this.getReceiptBlocks(receipt, currency)),
      ...PaginationView.getBlocks({
        page,
        pageSize: RECEIPTS_PAGE_SIZE,
        totalCount: receipts.length,
        prevPageActionId: ReceiptsTabActionId.PaginationPrev,
        nextPageActionId: ReceiptsTabActionId.PaginationNext,
      }),
    ];
  }

  // With `hidden` receipts not shown below it, a button to all of them.
  private getPersonHeading(
    person: IReceiptsMonthPerson,
    { limitCents }: IReimbursementViewModel,
    currency: string,
    hidden = false,
  ): AnyBlock {
    const total = formatMoney(
      person.acceptedCents + person.submittedCents,
      currency,
    );

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(person.name)}*${person.active ? '' : ' (deactivated)'} · ${total}${limitCents === null ? '' : ` of ${formatMoney(limitCents, currency)}`}${person.overLimit ? ' ⚠️ over the limit' : ''}`,
      },
      ...(hidden
        ? {
            accessory: button(
              `Show all ${person.receipts.length} receipts`,
              ReceiptsTabActionId.ShowPerson,
              person.userId,
            ),
          }
        : {}),
    };
  }

  private getPersonBlocks(
    person: IReceiptsMonthPerson,
    reimbursement: IReimbursementViewModel,
    currency: string,
    shown: number,
  ): AnyBlock[] {
    return [
      this.getPersonHeading(
        person,
        reimbursement,
        currency,
        shown < person.receipts.length,
      ),
      ...orderedReceipts(person)
        .slice(0, shown)
        .flatMap((receipt) => this.getReceiptBlocks(receipt, currency)),
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
