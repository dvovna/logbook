import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { AnyBlock } from '@slack/web-api';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ValidationError } from '@common/errors/validation.error';
import { JobsService } from '@common/jobs/jobs.service';
import { formatDateRange } from '@common/utils/date.utils';
import { runInBackground } from '@common/utils/run-in-background';
import { getDisplayTime } from '@common/utils/time.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { vacationTypeLabel } from '@modules/slack/common/views/data/labels';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import {
  ITimeOffOffer,
  ITimeOffResult,
  TimeOffLoggingService,
} from 'src/time-off-logging/services/time-off-logging.service';

export const LOG_TIME_OFF_ACTION_ID = 'log_time_off';

export const TIME_OFF_OFFER_JOB = 'time-off-offer-send';

interface IOfferJob {
  requestId: string;
  slackTeamId: string;
}

// Offers the requester to log an approved time off as time on the project of
// its leave type: a button in a DM, and what the click does.
@Injectable()
export class TimeOffOfferService implements OnModuleInit {
  private readonly logger = new Logger(TimeOffOfferService.name);

  public constructor(
    private readonly timeOffLoggingService: TimeOffLoggingService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly communicationService: SlackCommunicationService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IOfferJob>(TIME_OFF_OFFER_JOB, (job) =>
      this.sendOffer(job.requestId, job.slackTeamId),
    );
  }

  // The button, as blocks to put into a message. A message's action is
  // dispatched by the `block_id` of its first action.
  public getBlocks(offer: ITimeOffOffer): AnyBlock[] {
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

  // A request created already approved (HR files it so).
  @OnEvent(VacationRequestEvent.Created)
  public handleCreated({ request }: VacationRequestCreatedEvent) {
    if (request.status === VacationRequestStatus.Approved) {
      this.offerLater(request.id, request.slack_team_id);
    }
  }

  // An edit that approved the request, or moved the days of an approved one.
  // The workflow's own approval carries no `previous`: its decision DM holds
  // the button.
  @OnEvent(VacationRequestEvent.Updated)
  public handleUpdated({ request, previous }: VacationRequestUpdatedEvent) {
    if (!previous || request.status !== VacationRequestStatus.Approved) {
      return;
    }

    if (
      previous.status !== VacationRequestStatus.Approved ||
      previous.start_date !== request.start_date ||
      previous.end_date !== request.end_date
    ) {
      this.offerLater(request.id, request.slack_team_id);
    }
  }

  // The offer DM, as a job; sends nothing when the request no longer has an
  // offer (a retry after a change).
  public async sendOffer(requestId: string, slackTeamId: string) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });
    const offer =
      request && (await this.timeOffLoggingService.offerFor(request));

    if (!request || !offer) {
      return;
    }

    const project = escapeMrkdwn(offer.projectName);
    const text = `Log your ${vacationTypeLabel(request.type)} on ${project} as time?`;

    await this.communicationService.postMessage(
      request.user!.slack_id,
      {
        text,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${vacationTypeLabel(request.type)}* · ${formatDateRange(request.start_date, request.end_date)}\nLog it as time on *${project}*?`,
            },
          },
          ...(this.getBlocks(offer) as KnownBlock[]),
        ],
      },
      slackTeamId,
    );
  }

  // A click on the button. What can be refused answers the clicker here; the
  // logging and the message update run after the answer. Someone else's click
  // is dropped with a warning and the message stays as it is, as an approver
  // step's refused click is.
  public async handleClick(
    user: IUserViewModel,
    requestId: string,
    message: { channel?: string; ts?: string; blocks?: AnyBlock[] },
  ) {
    try {
      await this.timeOffLoggingService.assertCanLog(user, requestId);
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof NotFoundException
      ) {
        await this.tell(user, message.channel, (error as Error).message);

        return;
      }

      if (error instanceof ForbiddenException) {
        this.logger.warn(`Time off not logged: ${error.message}`);

        return;
      }

      throw error;
    }

    runInBackground(this.logger, 'log time off as time', async () => {
      try {
        const { offer, linked } = await this.timeOffLoggingService.log(
          user,
          requestId,
        );

        if (message.channel && message.ts) {
          await this.showResult(user, message, offer, linked);
        }
      } catch (error) {
        // What changed since the DM (the project archived, the request
        // canceled) is told to the clicker. Anything else is told generally
        // and rethrown, so it is logged and reported.
        if (
          error instanceof ValidationError ||
          error instanceof NotFoundException
        ) {
          await this.tell(user, message.channel, error.message);

          return;
        }

        if (error instanceof ForbiddenException) {
          this.logger.warn(`Time off not logged: ${error.message}`);

          return;
        }

        await this.tell(
          user,
          message.channel,
          "Couldn't log your time off, please try again.",
        ).catch(() => undefined);

        throw error;
      }
    });
  }

  private offerLater(requestId: string, slackTeamId: string) {
    this.jobs.run<IOfferJob>(TIME_OFF_OFFER_JOB, { requestId, slackTeamId });
  }

  private async tell(
    user: IUserViewModel,
    channel: string | undefined,
    text: string,
  ) {
    await this.communicationService.postEphemeral(
      channel ?? user.slack_id,
      { text },
      user.slack_team_id,
      user.slack_id,
    );
  }

  // The button gives way to what was done.
  private async showResult(
    user: IUserViewModel,
    {
      channel,
      ts,
      blocks = [],
    }: { channel?: string; ts?: string; blocks?: AnyBlock[] },
    offer: ITimeOffOffer,
    linked: ITimeOffResult['linked'],
  ) {
    const project = escapeMrkdwn(offer.projectName);
    // What is stored for the request, so every click (the first, a second at
    // once, a late one) writes the same true text.
    const skipped = offer.dates.filter((date) => !linked.dates.includes(date));
    const lines = linked.minutes
      ? [
          `✅ ${getDisplayTime(linked.minutes)} logged to ${project}.`,
          ...(skipped.length
            ? [
                `Skipped, already have time on ${project}: ${skipped
                  .map((date) => formatDateRange(date, date))
                  .join(', ')}.`,
              ]
            : []),
        ]
      : [`Nothing was logged: those days already have time on ${project}.`];
    const result: KnownBlock = {
      type: 'section',
      text: { type: 'mrkdwn', text: lines.join('\n') },
    };

    await this.communicationService.updateMessage(
      channel!,
      ts!,
      {
        text: lines[0],
        blocks: blocks.length
          ? (blocks as KnownBlock[]).map((block) =>
              block.block_id === ViewCallbackId.TimeOffLoggingOffer
                ? result
                : block,
            )
          : [result],
      },
      user.slack_team_id,
    );
  }
}
