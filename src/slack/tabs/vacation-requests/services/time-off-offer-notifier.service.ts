import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { JobsService } from '@common/jobs/jobs.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { UsersService } from '@modules/users/services/users.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestCreatedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { TIME_OFF_OFFER_JOB } from '@modules/slack/tabs/vacation-requests/constants/time-off-offer';
import {
  IOfferJob,
  IRemovedTimeNotice,
  ITimeOffMessage,
  TimeOffChange,
} from '@modules/slack/tabs/vacation-requests/types/time-off-offer.types';
import { TimeOffOfferView } from '@modules/slack/tabs/vacation-requests/views/time-off-offer.view';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeOffChangedEvent } from 'src/time-off-logging/events/time-off.events';
import { VacationRequestUpdatedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { IRemovedVacationTime } from 'src/time-off-logging/types/vacation-time.types';
import { changesLoggedTime } from 'src/time-off-logging/utils/vacation-time.utils';

// The DMs that offer to log a time off as time outside the decision DM, and
// that tell what logged time a change or a deletion removed. The listeners
// run in the transaction of the change (emitAsync), so the DMs' jobs are
// saved with it.
@Injectable()
export class TimeOffOfferNotifier implements OnModuleInit {
  public constructor(
    private readonly timeOffLoggingService: TimeOffLoggingService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly communicationService: SlackCommunicationService,
    private readonly jobs: JobsService,
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly view: TimeOffOfferView,
  ) {}

  public onModuleInit() {
    this.jobs.define<IOfferJob>(TIME_OFF_OFFER_JOB, (job) =>
      this.sendOffer(job),
    );
  }

  // A request created already approved (HR files it so).
  @OnEvent(VacationRequestEvent.Created, { suppressErrors: false })
  public async handleCreated({ request }: VacationRequestCreatedEvent) {
    if (request.status === VacationRequestStatus.Approved) {
      await this.offerLater([this.offer(request)]);
    }
  }

  // The workflow's own approval carries no `previous`: its decision DM holds
  // the button. Removed time is told to whoever logged it: in the offer's DM
  // when the request is still theirs and approved, else in a DM of its own; a
  // new person gets the offer in a DM of their own.
  @OnEvent(VacationRequestEvent.Updated, { suppressErrors: false })
  public async handleUpdated({
    request,
    previous,
    removedTime,
  }: VacationRequestUpdatedEvent & Partial<TimeOffChangedEvent>) {
    const offers =
      !!previous &&
      request.status === VacationRequestStatus.Approved &&
      changesLoggedTime(previous, request);

    if (!previous || !removedTime) {
      if (offers) {
        await this.offerLater([this.offer(request)]);
      }

      return;
    }

    const jobs = removedTime.owners.map((owner) => {
      const removed = this.removedNotice(
        previous,
        removedTime,
        owner,
        this.changeOf(request, owner.userId),
      );

      return this.offer(
        request,
        offers && owner.userId === request.user_id
          ? { removed }
          : { removed, removalOnly: true },
      );
    });

    if (
      offers &&
      !removedTime.owners.some(({ userId }) => userId === request.user_id)
    ) {
      jobs.push(this.offer(request));
    }

    await this.offerLater(jobs);
  }

  @OnEvent(VacationRequestEvent.Deleted, { suppressErrors: false })
  public async handleDeleted({ request, removedTime }: TimeOffChangedEvent) {
    await this.offerLater(
      (removedTime?.owners ?? []).map((owner) =>
        this.offer(request, {
          removed: this.removedNotice(request, removedTime!, owner, 'deleted'),
          removalOnly: true,
        }),
      ),
    );
  }

  // Sends nothing when the request no longer has an offer (a retry after a
  // change) and there is no removal to tell.
  private async sendOffer({
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

    const messages = [
      removal?.message,
      offerTo ? this.view.getOfferMessage(request!, offer!) : undefined,
    ].filter((message): message is ITimeOffMessage => !!message);

    await this.communicationService.postMessage(
      removal ? removal.to : offerTo!,
      {
        text: messages[0].text,
        blocks: messages.flatMap(({ blocks }) => blocks),
      },
      slackTeamId,
    );
  }

  private offer(
    request: IVacationRequestViewModel,
    removal: Pick<IOfferJob, 'removed' | 'removalOnly'> = {},
  ): IOfferJob {
    return {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      ...removal,
    };
  }

  // In one statement, however many people's time went.
  private offerLater(jobs: IOfferJob[]) {
    return this.jobs.enqueueMany<IOfferJob>(TIME_OFF_OFFER_JOB, jobs);
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

  // For whose time it was; null when they were deactivated since.
  private async removalOf(
    removed: IRemovedTimeNotice,
    slackTeamId: string,
  ): Promise<{ to: string; message: ITimeOffMessage } | null> {
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

    return {
      to: user.slack_id,
      message: this.view.getRemovalMessage(
        removed,
        projects.map(({ name }) => name),
      ),
    };
  }
}
