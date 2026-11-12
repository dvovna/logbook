import { Injectable } from '@nestjs/common';
import pluralize from 'pluralize';
import VacationType from '@common/enums/vacation-type.enum';
import {
  formatDate,
  formatDateRange,
  formatDayMonth,
} from '@common/utils/date.utils';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import {
  clip,
  context,
  fullList,
  IMessagePart,
  messageBlocks,
  section,
} from '@modules/slack/common/views/components/message-sections';
import {
  personLabel,
  VACATION_TYPE_LABELS,
  vacationTypeLabel,
} from '@modules/slack/common/views/data/labels';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { LeaveFileMessageActionId } from '@modules/slack/leave-file/enums/leave-file-message-action-id.enum';
import { ILeaveFileMessage } from '@modules/slack/leave-file/types/leave-file-message.interface';
import { ILeft } from '@modules/vacation-requests/utils/leave-balance.utils';
import { BALANCES_HEADERS } from 'src/leave-file/constants/leave-file-headers';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { balancesPlanChangesNothing } from 'src/leave-file/services/leave-balances-planner';
import { historyPlanChangesNothing } from 'src/leave-file/services/leave-history-planner';
import { ILeaveBalancesPlan } from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveFilePreview } from 'src/leave-file/types/leave-file-apply-result.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';
import { ILeaveHistoryPlan } from 'src/leave-file/types/leave-history-plan.interface';

// Names and reasons come from the file or from people, so the longest ones
// are cut before they are escaped (cutting after could split an entity).
const MAX_NAME_CHARACTERS = 80;
const MAX_REASON_CHARACTERS = 200;

const CHANGED_SINCE_PREVIEW =
  "Logbook changed since this preview, so here's what the file will do now.";
const CLOSED_TEXTS: Partial<Record<LeaveFileUploadStatus | 'expired', string>> =
  {
    [LeaveFileUploadStatus.Superseded]:
      'A newer file replaced this one. Nothing changed.',
    [LeaveFileUploadStatus.Canceled]: 'Canceled. Nothing changed.',
    expired: 'This preview has expired. Send the file again.',
  };

type IShownUpload = Pick<ILeaveFileUpload, 'id' | 'file_name' | 'plan_digest'>;
type ICounts = Record<keyof ILeft, number | null>;
type ILeave = { type: VacationType; startDate: string; endDate: string };

const UNITS: (keyof ILeft)[] = ['days', 'workingDays', 'bonusDays'];
const UNIT_WORDS: Record<keyof ILeft, string> = {
  days: 'day',
  workingDays: 'working day',
  bonusDays: 'bonus day',
};
const [, , , , DAYS_LEFT, WORKING_DAYS_LEFT, BONUS_DAYS_LEFT] =
  BALANCES_HEADERS;
const COLUMN_OF_UNIT: Record<keyof ILeft, string> = {
  days: DAYS_LEFT,
  workingDays: WORKING_DAYS_LEFT,
  bonusDays: BONUS_DAYS_LEFT,
};
// The leave each unit of a balance is taken by.
const TYPE_OF_UNIT: Record<keyof ILeft, VacationType> = {
  days: VacationType.AnnualLeave,
  workingDays: VacationType.AnnualLeave,
  bonusDays: VacationType.BonusDay,
};

const safe = (text: string, max = MAX_NAME_CHARACTERS) =>
  escapeMrkdwn(clip(text, max));
const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const people = (count: number) => counted(count, 'person', 'people');
const leaves = (count: number) => counted(count, 'leave', 'leaves');
const amount = (count: number, unit: keyof ILeft) =>
  `${count} ${pluralize(UNIT_WORDS[unit], count)}`;
const signed = (count: number) => (count > 0 ? `+${count}` : `${count}`);

const changesNothing = (preview: ILeaveFilePreview) =>
  preview.kind === LeaveFileKind.Balances
    ? balancesPlanChangesNothing(preview.plan)
    : historyPlanChangesNothing(preview.plan);

const countsOf = (balance: ILeaveBalancesPlan['balances'][number]) => ({
  days: balance.daysLeft,
  workingDays: balance.workingDaysLeft,
  bonusDays: balance.bonusDaysLeft,
});

// "9 working days left, Logbook counts 7 → correction +2", per unit the file
// gives that differs from Logbook's count.
const correctionsOf = (balance: ILeaveBalancesPlan['balances'][number]) =>
  UNITS.flatMap((unit) => {
    const count = countsOf(balance)[unit];
    const logbook = balance.counted[unit];

    return count === null || count === logbook
      ? []
      : [
          `${amount(count, unit)} left, Logbook counts ${logbook} → correction ${signed(count - logbook)}`,
        ];
  });

// "12 left, 1 after 21–31 Dec 2026; 2 bonus days left, 1 after 4 Dec 2026",
// per unit the file gives that the leave takes from. Empty when it takes
// from none of them.
const plannedLine = (left: ICounts, after: ICounts, leave: ILeave[]) =>
  UNITS.flatMap((unit) => {
    const count = left[unit];
    const taking = leave.filter(({ type }) => type === TYPE_OF_UNIT[unit]);

    if (count === null || !taking.length) {
      return [];
    }

    const ranges = taking
      .map(({ startDate, endDate }) => formatDateRange(startDate, endDate))
      .join(', ');
    // The mockup's words: days of annual leave need no unit.
    const what =
      unit === 'days' ? `${count} left` : `${amount(count, unit)} left`;

    return [`${what}, ${after[unit] ?? count} after ${ranges}`];
  }).join('; ');

// "a", "a and b", "a, b and c".
const andList = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
    : items.join('');

// "12 days left on 1 Dec 2025 (fill Days left to keep a balance)", of the
// units of an earlier balance that a row of another year leaves empty.
const droppedLine = ({
  balanceOn,
  ...counts
}: NonNullable<ILeaveBalancesPlan['balances'][number]['dropped']>) => {
  const units = UNITS.filter((unit) => counts[unit] !== null);

  return `${units
    .map((unit) => `${amount(counts[unit]!, unit)} left`)
    .join(', ')} on ${formatDate(balanceOn)} (fill ${andList(
    units.map((unit) => COLUMN_OF_UNIT[unit]),
  )} to keep a balance)`;
};

// Where the vacation year starts: the contract start's anniversary, else
// 1 January.
const yearStartOf = (contractStart: string | null) =>
  contractStart ? formatDayMonth(contractStart) : '1 Jan';

const contractStartLine = ({
  before,
  after,
  movedBalanceOn,
}: ILeaveBalancesPlan['contractStarts'][number]) => {
  const change =
    yearStartOf(after) !== yearStartOf(before)
      ? `from ${yearStartOf(after)} (was ${yearStartOf(before)})`
      : `contract start ${formatDate(after)} (was ${before ? formatDate(before) : 'none'})`;

  return movedBalanceOn
    ? `${change}. The balance of ${formatDate(movedBalanceOn)} now falls in the year before and carries over.`
    : change;
};

const typeCount = (type: VacationType, count: number) =>
  type === VacationType.BonusDay
    ? pluralize('bonus day', count, true)
    : `${count} ${vacationTypeLabel(type).toLowerCase()}`;

const button = (actionId: string, text: string, value?: string) => ({
  type: 'button' as const,
  action_id: actionId,
  text: { type: 'plain_text' as const, text },
  ...(value ? { value } : {}),
});

@Injectable()
export class LeaveFileMessageView {
  // What the file will do, in the order HR needs to check it. `today` is
  // the app's, for the leave that is still to come.
  public preview(
    preview: ILeaveFilePreview,
    upload: IShownUpload,
    today: string,
  ): ILeaveFileMessage {
    if (changesNothing(preview)) {
      return this.nothingToChange(preview);
    }

    const text = `Here's what ${safe(upload.file_name)} will do`;

    return {
      text,
      blocks: messageBlocks([
        section(`*${text}*`),
        ...this.changes(preview, upload, today),
      ]),
    };
  }

  // Apply found the workspace changed since the preview: what the file will
  // do now, to check again. `upload` carries the new plan's digest.
  public changedPreview(
    preview: ILeaveFilePreview,
    upload: IShownUpload,
    today: string,
  ): ILeaveFileMessage {
    return {
      text: CHANGED_SINCE_PREVIEW,
      blocks: messageBlocks([
        section(CHANGED_SINCE_PREVIEW),
        ...(changesNothing(preview)
          ? this.nothingToChangeParts(preview).parts
          : this.changes(preview, upload, today)),
      ]),
    };
  }

  public nothingToChange(preview: ILeaveFilePreview): ILeaveFileMessage {
    const { text, parts } = this.nothingToChangeParts(preview);

    return { text, blocks: messageBlocks(parts) };
  }

  public canceled(): ILeaveFileMessage {
    return this.closed(LeaveFileUploadStatus.Canceled)!;
  }

  // Why Apply did nothing, or null when the message already says what
  // happened (a second click on an applied file).
  public closed(
    status: LeaveFileUploadStatus | 'expired',
  ): ILeaveFileMessage | null {
    const text = CLOSED_TEXTS[status];

    return text ? { text, blocks: [section(text)] } : null;
  }

  // What Apply did, in counts, with the rows it left out, since the preview
  // that listed them is replaced.
  public applied(
    preview: ILeaveFilePreview,
    uploadId: string,
  ): ILeaveFileMessage {
    const text = this.appliedText(preview);
    const open =
      preview.kind === LeaveFileKind.Balances
        ? button(NavigationActionId.People, 'Open People')
        : button(NavigationActionId.TimeOff, 'Open Time off');

    return {
      text,
      blocks: messageBlocks([
        section(text),
        ...this.unusable(preview.plan.unusable, "Rows it didn't use"),
        {
          type: 'actions',
          block_id: ViewCallbackId.LeaveFileMessage,
          elements: [
            open,
            button(
              LeaveFileMessageActionId.Undo,
              'Undo',
              `${LeaveFileMessageActionId.Undo}:${uploadId}`,
            ),
          ],
        },
      ]),
    };
  }

  // What Undo put back, and what it left because it changed since.
  public undone(restored: number, kept: string[]): ILeaveFileMessage {
    const text = `↩️ Undone: ${counted(restored, 'change', 'changes')} restored.`;

    return {
      text,
      blocks: messageBlocks([
        kept.length
          ? fullList(
              text,
              kept.map((line) => safe(line, MAX_REASON_CHARACTERS)),
              'Kept, because they changed since:',
            )
          : section(text),
      ]),
    };
  }

  // E.g. "✅ Set balances for 3 people. Changed the contract start of 1
  // person. 2 rows weren't used.", with the parts that are zero left out.
  private appliedText(preview: ILeaveFilePreview) {
    const unusable = preview.plan.unusable.length;
    const unused = unusable
      ? `${counted(unusable, "row wasn't", "rows weren't")} used.`
      : null;
    const done =
      preview.kind === LeaveFileKind.History
        ? [
            `Added ${leaves(preview.plan.add.length)} for ${people(
              new Set(preview.plan.add.map(({ userId }) => userId)).size,
            )}.`,
          ]
        : [
            preview.plan.balances.length &&
              `Set balances for ${people(preview.plan.balances.length)}.`,
            preview.plan.contractStarts.length &&
              `Changed the contract start of ${people(preview.plan.contractStarts.length)}.`,
          ];

    return `✅ ${[...done, unused].filter((part) => !!part).join(' ')}`;
  }

  private nothingToChangeParts({ plan }: ILeaveFilePreview) {
    const unusable = this.unusable(plan.unusable, "Rows it can't use");
    const text = unusable.length
      ? 'Nothing to change.'
      : 'Nothing to change: everything in the file is already in Logbook.';

    return { text, parts: [section(text), ...unusable] };
  }

  // The preview after its heading, of a plan that changes something.
  private changes(
    preview: ILeaveFilePreview,
    upload: IShownUpload,
    today: string,
  ): IMessagePart[] {
    const byId = new Map(preview.people.map((p) => [p.id, p]));
    const nameOf = (id: string) => {
      const person = byId.get(id);

      return person ? safe(personLabel(person)) : 'Someone';
    };

    return [
      ...(preview.kind === LeaveFileKind.Balances
        ? this.balancesChanges(preview.plan, nameOf)
        : this.historyChanges(preview.plan, nameOf, today)),
      ...this.unusable(preview.plan.unusable, "Rows it can't use"),
      ...(preview.kind === LeaveFileKind.Balances && preview.plan.unchanged
        ? [
            context(
              `${counted(preview.plan.unchanged, 'row changes', 'rows change')} nothing.`,
            ),
          ]
        : []),
      {
        type: 'actions',
        block_id: ViewCallbackId.LeaveFileMessage,
        elements: [
          {
            ...button(
              LeaveFileMessageActionId.Apply,
              'Apply',
              // Apply does only the plan this preview shows.
              `${LeaveFileMessageActionId.Apply}:${upload.id}:${upload.plan_digest}`,
            ),
            style: 'primary',
          },
          button(
            LeaveFileMessageActionId.Cancel,
            'Cancel',
            `${LeaveFileMessageActionId.Cancel}:${upload.id}`,
          ),
        ],
      },
    ];
  }

  private balancesChanges(
    plan: ILeaveBalancesPlan,
    nameOf: (id: string) => string,
  ): IMessagePart[] {
    const blocks: IMessagePart[] = [];
    const count = plan.balances.length;
    const dates = [...new Set(plan.balances.map((b) => b.balanceOn))];

    if (count) {
      blocks.push(
        section(
          dates.length === 1
            ? `Balances on *${formatDate(dates[0])}* for ${people(count)}. Leave from that day on is taken from them as usual.`
            : `Balances for ${people(count)}, on the dates in the file.`,
        ),
      );
    }

    const corrections = plan.balances
      .map((balance) => ({ balance, parts: correctionsOf(balance) }))
      .filter(({ parts }) => parts.length);

    if (corrections.length) {
      blocks.push(
        fullList(
          `*Corrections (${corrections.length})*: the file's balance differs from what Logbook counts`,
          corrections.map(
            ({ balance, parts }) =>
              `${nameOf(balance.userId)}: ${parts.join('; ')}`,
          ),
        ),
      );
    }

    const matching = count - corrections.length;

    if (matching) {
      blocks.push(
        context(
          `${counted(matching, 'person matches', 'people match')} what Logbook counts.`,
        ),
      );
    }

    const dropped = plan.balances.filter(({ dropped }) => dropped);

    if (dropped.length) {
      blocks.push(
        fullList(
          `*Earlier balances that go (${dropped.length})*: the file's date replaces them`,
          dropped.map(
            ({ userId, dropped }) =>
              `${nameOf(userId)}: ${droppedLine(dropped!)}`,
          ),
        ),
      );
    }

    if (plan.contractStarts.length) {
      blocks.push(
        fullList(
          `*Vacation year changes (${plan.contractStarts.length})*: contract start set`,
          plan.contractStarts.map(
            (change) =>
              `${nameOf(change.userId)}: ${contractStartLine(change)}`,
          ),
        ),
      );
    }

    const planned = plan.balances
      .map((balance) => ({
        userId: balance.userId,
        line: plannedLine(countsOf(balance), balance.after, balance.planned),
      }))
      .filter(({ line }) => line);

    if (planned.length) {
      blocks.push(
        fullList(
          `*Planned leave (${planned.length})*: already in Logbook, from the balance date on`,
          planned.map(({ userId, line }) => `${nameOf(userId)}: ${line}`),
        ),
      );
    }

    return blocks;
  }

  private historyChanges(
    plan: ILeaveHistoryPlan,
    nameOf: (id: string) => string,
    today: string,
  ): IMessagePart[] {
    const blocks: IMessagePart[] = [];
    const who = new Set(plan.add.map(({ userId }) => userId)).size;
    // In the order the labels list the types.
    const byType = (Object.keys(VACATION_TYPE_LABELS) as VacationType[])
      .map((type) => ({
        type,
        count: plan.add.filter((leave) => leave.type === type).length,
      }))
      .filter(({ count }) => count)
      .map(({ type, count }) => typeCount(type, count))
      .join(', ');
    const ahead = plan.add.filter(({ endDate }) => endDate >= today).length;

    blocks.push(
      section(
        `Adds *${leaves(plan.add.length)}* for ${people(who)} as approved. Nobody is asked to approve them and nobody gets a message.`,
      ),
      context(
        `${byType}.${ahead ? ` ${counted(ahead, 'of them is', 'of them are')} from today on.` : ''}`,
      ),
    );

    if (plan.balanceChanges.length) {
      blocks.push(
        fullList(
          `*Balances that change (${plan.balanceChanges.length})*: people with no balance from a file`,
          plan.balanceChanges.map(
            ({ userId, before, after }) =>
              `${nameOf(userId)}: ${UNITS.filter(
                (unit) => before[unit] !== after[unit],
              )
                .map(
                  (unit) =>
                    `${before[unit]} → ${amount(after[unit], unit)} left`,
                )
                .join(', ')}`,
          ),
        ),
      );
    }

    const planned = plan.plannedLeave
      .map(({ userId, left, after, leave }) => ({
        userId,
        line: plannedLine(left, after, leave),
      }))
      .filter(({ line }) => line);

    if (planned.length) {
      blocks.push(
        fullList(
          `*Planned leave (${planned.length})*: taken from a balance from a file`,
          planned.map(({ userId, line }) => `${nameOf(userId)}: ${line}`),
        ),
      );
    }

    if (plan.skipped) {
      blocks.push(section(`*Already in Logbook (${plan.skipped})*: skipped`));
    }

    return blocks;
  }

  private unusable(
    unusable: { row: number; reason: string }[],
    title: string,
  ): IMessagePart[] {
    return unusable.length
      ? [
          fullList(
            `⚠️ *${title} (${unusable.length})*`,
            unusable.map(
              ({ row, reason }) =>
                `Row ${row}: ${safe(reason, MAX_REASON_CHARACTERS)}`,
            ),
          ),
        ]
      : [];
  }
}
