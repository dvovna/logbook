import { Injectable } from '@nestjs/common';
import type { AnyBlock } from '@slack/web-api';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import { formatDateList, formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { vacationTypeLabel } from '@modules/slack/common/views/data/labels';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';
import {
  LOG_TIME_OFF_ACTION_ID,
  TIME_OFF_CHANGE_WORDS,
} from '@modules/slack/tabs/vacation-requests/constants/time-off-offer';
import {
  IRemovedTimeNotice,
  ITimeOffMessage,
} from '@modules/slack/tabs/vacation-requests/types/time-off-offer.types';
import {
  ITimeOffOffer,
  ITimeOffResult,
} from 'src/time-off-logging/services/time-off-logging.service';

@Injectable()
export class TimeOffOfferView {
  // A message's action is dispatched by the `block_id` of its first action.
  public getButtonBlocks(offer: ITimeOffOffer): KnownBlock[] {
    const hours = getDisplayTime(offer.dates.length * offer.minutes);

    return [
      {
        type: 'actions',
        block_id: ViewCallbackId.TimeOffLoggingOffer,
        elements: [
          {
            type: 'button',
            action_id: LOG_TIME_OFF_ACTION_ID,
            value: offer.requestId,
            text: {
              type: 'plain_text',
              text: `Log ${hours} to ${offer.projectName}`,
            },
          },
        ],
      },
    ];
  }

  public getOfferMessage(
    request: IVacationRequestViewModel,
    offer: ITimeOffOffer,
  ): ITimeOffMessage {
    const type = vacationTypeLabel(request.type);
    const project = escapeMrkdwn(offer.projectName);

    return {
      text: `Log your ${type} on ${project} as time?`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${type}* · ${formatDateRange(request.start_date, request.end_date)}\nLog it as time on *${project}*?`,
          },
        },
        ...this.getButtonBlocks(offer),
      ],
    };
  }

  // `projectNames`: the projects the removed time was on.
  public getRemovalMessage(
    removed: IRemovedTimeNotice,
    projectNames: string[],
  ): ITimeOffMessage {
    const names = projectNames.map((name) => escapeMrkdwn(name)).sort();
    const onProjects =
      names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : (names[0] ?? 'its project');
    const what = `${vacationTypeLabel(removed.type).toLowerCase()} ${formatDateRange(removed.startDate, removed.endDate)}`;
    const text = withBilledDays(
      `Your ${what} ${TIME_OFF_CHANGE_WORDS[removed.change]}: the ${getDisplayTime(removed.minutes)} logged on ${onProjects} were removed.`,
      removed.billedDates,
    );

    return {
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    };
  }

  // The button in `blocks` gives way to what was done. The text comes from
  // what is stored for the request, so every click (the first, a second at
  // once, a late one) writes the same true text. Days the request holds on
  // another project (billed time of its type before HR changed it) are named
  // apart from those with someone's time on this project.
  public getResultMessage(
    blocks: AnyBlock[],
    offer: ITimeOffOffer,
    { dates: linkedDates, minutes, otherProjects }: ITimeOffResult['linked'],
  ): ITimeOffMessage {
    const project = escapeMrkdwn(offer.projectName);
    const days = (dates: string[]) => formatDateList([...dates].sort());
    const skipped = offer.dates.filter(
      (date) =>
        !linkedDates.includes(date) &&
        !otherProjects.some(({ dates }) => dates.includes(date)),
    );
    const lines =
      minutes || otherProjects.length
        ? [
            minutes
              ? `✅ ${getDisplayTime(minutes)} logged to ${project}.`
              : `Nothing was logged to ${project}.`,
            ...otherProjects.map(
              ({ projectName, dates }) =>
                `Already logged for this time off on ${escapeMrkdwn(projectName)}: ${days(dates)}.`,
            ),
            ...(skipped.length
              ? [`Skipped, already have time on ${project}: ${days(skipped)}.`]
              : []),
          ]
        : [`Nothing was logged: those days already have time on ${project}.`];
    const result: KnownBlock = {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    };

    return {
      text: lines[0],
      blocks: blocks.length
        ? (blocks as KnownBlock[]).map((block) =>
            block.block_id === ViewCallbackId.TimeOffLoggingOffer
              ? result
              : block,
          )
        : [result],
    };
  }
}
