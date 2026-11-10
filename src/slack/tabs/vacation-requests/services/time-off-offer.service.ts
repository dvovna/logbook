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
import VacationType from '@common/enums/vacation-type.enum';
import { ValidationError } from '@common/errors/validation.error';
import { JobsService } from '@common/jobs/jobs.service';
import { formatDateList, formatDateRange } from '@common/utils/date.utils';
import { runInBackground } from '@common/utils/run-in-background';
import { getDisplayTime } from '@common/utils/time.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { vacationTypeLabel } from '@modules/slack/common/views/data/labels';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';
import ProjectsService from 'src/projects/services/projects.service';
import { IRemovedVacationTime } from 'src/time-entries/services/time-entries.service';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { changesLoggedTime } from '@modules/vacation-requests/utils/vacation-time.utils';
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
  // The time an edit or a deletion removed from the request, told in the
  // same DM before the offer.
  removed?: IRemovedTimeNotice;
  // Only the removal: the request is gone, holds no offer, or the offer goes
  // to someone else (its person changed).
  removalOnly?: boolean;
}

// What happened to the time off that removed its logged time.
type TimeOffChange =
  'changed' | 'rejected' | 'canceled' | 'pending' | 'deleted' | 'moved';

// How the removal DM says it: 'Your annual leave 15–19 Jun 2026 was rejected'.
const CHANGE_WORDS: Record<TimeOffChange, string> = {
  changed: 'changed',
  rejected: 'was rejected',
  canceled: 'was canceled',
  pending: 'waits for approval again',
  deleted: 'was deleted',
  moved: 'was moved to someone else',
};

// What a person hears of their removed time: the time off as it was when the
// time was logged, what happened to it, and what went. The request may be
// gone when the job runs, so the job carries it.
interface IRemovedTimeNotice {
  userId: string;
  type: VacationType;
  startDate: string;
  endDate: string;
  change: TimeOffChange;
  minutes: number;
  projectIds: string[];
  billedDates: string[];
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
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IOfferJob>(TIME_OFF_OFFER_JOB, (job) =>
      this.sendOffer(job),
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

  // An edit that approved the request, or changed the person, days or type
  // of an approved one (which removed its logged time). The workflow's own
  // approval carries no `previous`: its decision DM holds the button.
  // Time the edit removed is told to whose it was (who logged it): in the
  // offer's DM when the request is still theirs and approved, in a DM of its
  // own otherwise; a new person gets the offer in a DM of their own.
  @OnEvent(VacationRequestEvent.Updated)
  public handleUpdated({
    request,
    previous,
    removedTime,
  }: VacationRequestUpdatedEvent) {
    const offers =
      !!previous &&
      request.status === VacationRequestStatus.Approved &&
      changesLoggedTime(previous, request);

    if (!previous || !removedTime) {
      if (offers) {
        this.offerLater(request.id, request.slack_team_id);
      }

      return;
    }

    for (const owner of removedTime.owners) {
      const removed = this.removedNotice(
        previous,
        removedTime,
        owner,
        this.changeOf(request, owner.userId),
      );

      this.offerLater(
        request.id,
        request.slack_team_id,
        offers && owner.userId === request.user_id
          ? { removed }
          : { removed, removalOnly: true },
      );
    }

    if (
      offers &&
      !removedTime.owners.some(({ userId }) => userId === request.user_id)
    ) {
      this.offerLater(request.id, request.slack_team_id);
    }
  }

  // A deletion that removed logged time: whose time it was hears what went.
  @OnEvent(VacationRequestEvent.Deleted)
  public handleDeleted({ request, removedTime }: VacationRequestUpdatedEvent) {
    for (const owner of removedTime?.owners ?? []) {
      this.offerLater(request.id, request.slack_team_id, {
        removed: this.removedNotice(request, removedTime!, owner, 'deleted'),
        removalOnly: true,
      });
    }
  }

  // The offer DM, as a job, with the removed time first when there is some;
  // sends nothing when the request no longer has an offer (a retry after a
  // change) and there is no removal to tell.
  public async sendOffer({
    requestId,
    slackTeamId,
    removed,
    removalOnly,
  }: IOfferJob) {
    const request = removalOnly
      ? null
      : await this.vacationRequestsService.findOne({
          id: requestId,
          slackTeamId,
        });
    const offer =
      request && (await this.timeOffLoggingService.offerFor(request));
    const removal = removed && (await this.removalOf(removed, slackTeamId));
    // The removal goes to whose time it was, the offer to whose request it
    // is: in one DM only when that is one person.
    const offerTo =
      request && offer && (!removal || request.user_id === removed!.userId)
        ? request.user!.slack_id
        : null;

    if (!offerTo && !removal) {
      return;
    }

    const project = offer ? escapeMrkdwn(offer.projectName) : '';
    const offerBlocks: KnownBlock[] =
      offerTo && request
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*${vacationTypeLabel(request.type)}* · ${formatDateRange(request.start_date, request.end_date)}\nLog it as time on *${project}*?`,
              },
            },
            ...(this.getBlocks(offer!) as KnownBlock[]),
          ]
        : [];

    await this.communicationService.postMessage(
      removal ? removal.to : offerTo!,
      {
        text: removal
          ? removal.text
          : `Log your ${vacationTypeLabel(request!.type)} on ${project} as time?`,
        blocks: [
          ...(removal
            ? [
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: removal.text },
                } as KnownBlock,
              ]
            : []),
          ...offerBlocks,
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
      if (await this.refuse(error, user, message.channel)) {
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
        if (await this.refuse(error, user, message.channel)) {
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

  // A click refused for what the clicker can know (told to them) or for
  // being someone else's (dropped with a warning). False for any other error.
  private async refuse(
    error: unknown,
    user: IUserViewModel,
    channel: string | undefined,
  ): Promise<boolean> {
    if (
      error instanceof ValidationError ||
      error instanceof NotFoundException
    ) {
      await this.tell(user, channel, error.message);

      return true;
    }

    if (error instanceof ForbiddenException) {
      this.logger.warn(`Time off not logged: ${error.message}`);

      return true;
    }

    return false;
  }

  private offerLater(
    requestId: string,
    slackTeamId: string,
    removal: Pick<IOfferJob, 'removed' | 'removalOnly'> = {},
  ) {
    this.jobs.run<IOfferJob>(TIME_OFF_OFFER_JOB, {
      requestId,
      slackTeamId,
      ...removal,
    });
  }

  // `request` as its time was logged (before the edit, or as deleted), and
  // what `owner` had logged of it.
  private removedNotice(
    request: IVacationRequestViewModel,
    { billedDates }: IRemovedVacationTime,
    { userId, minutes, projectIds }: IRemovedVacationTime['owners'][number],
    change: TimeOffChange,
  ): IRemovedTimeNotice {
    return {
      userId,
      type: request.type,
      startDate: request.start_date,
      endDate: request.end_date,
      change,
      minutes,
      projectIds,
      billedDates,
    };
  }

  // What an edit did to the time off of `ownerId`, as the edited `request`
  // shows it.
  private changeOf(
    request: IVacationRequestViewModel,
    ownerId: string,
  ): TimeOffChange {
    if (request.user_id !== ownerId) {
      return 'moved';
    }

    switch (request.status) {
      case VacationRequestStatus.Rejected:
        return 'rejected';
      case VacationRequestStatus.Canceled:
        return 'canceled';
      case VacationRequestStatus.Pending:
        return 'pending';
      default:
        return 'changed';
    }
  }

  // 'Your annual leave 16–20 Nov 2026 was rejected: the 40h logged on
  // Vacations were removed.', with the billed days that stay, for whose time
  // it was. Null when they were deactivated since.
  private async removalOf(
    removed: IRemovedTimeNotice,
    slackTeamId: string,
  ): Promise<{ to: string; text: string } | null> {
    const [user, projects] = await Promise.all([
      this.usersService.findOne({
        id: removed.userId,
        slackTeamId,
        includeInactive: true,
      }),
      this.projectsService.findMany({
        ids: removed.projectIds,
        slackTeamId,
        includeArchived: true,
      }),
    ]);

    if (!user?.is_active) {
      return null;
    }

    const names = projects.map(({ name }) => escapeMrkdwn(name)).sort();
    const onProjects =
      names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
        : (names[0] ?? 'its project');
    const what = `${vacationTypeLabel(removed.type).toLowerCase()} ${formatDateRange(removed.startDate, removed.endDate)}`;

    return {
      to: user.slack_id,
      text: withBilledDays(
        `Your ${what} ${CHANGE_WORDS[removed.change]}: the ${getDisplayTime(removed.minutes)} logged on ${onProjects} were removed.`,
        removed.billedDates,
      ),
    };
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
    // '17–18 Jun, 22 Jun', as the notice of billed days.
    const days = (dates: string[]) => formatDateList([...dates].sort());
    // What is stored for the request, so every click (the first, a second at
    // once, a late one) writes the same true text. Days the request holds on
    // another project (billed time of its type before HR changed it) are
    // named apart from those with someone's time on this project.
    const { otherProjects } = linked;
    const skipped = offer.dates.filter(
      (date) =>
        !linked.dates.includes(date) &&
        !otherProjects.some(({ dates }) => dates.includes(date)),
    );
    const lines =
      linked.minutes || otherProjects.length
        ? [
            linked.minutes
              ? `✅ ${getDisplayTime(linked.minutes)} logged to ${project}.`
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
