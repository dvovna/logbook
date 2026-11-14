import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { todayIso } from '@common/utils/period-presets';
import { coversDayOf } from '@modules/users/repositories/time-off-condition';
import { AbsenceCheckService } from '@modules/request-workflows/services/absence-check.service';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

// Time off approved for today puts its person out of reach at once: the
// requests waiting for them move on now, not at the next daily check. The
// events are emitted inside the change's transaction, so the jobs are saved
// with it.
@Injectable()
export class ApproverAbsenceTriggerService {
  public constructor(
    private readonly absenceCheckService: AbsenceCheckService,
  ) {}

  @OnEvent(VacationRequestEvent.Created, { suppressErrors: false })
  public handleCreated({ request }: VacationRequestCreatedEvent) {
    return this.check(request);
  }

  // The workflow's own approval arrives without `previous`; an edit by HR or
  // an admin with it, and counts only when it makes this person newly away.
  @OnEvent(VacationRequestEvent.Updated, { suppressErrors: false })
  public handleUpdated({ request, previous }: VacationRequestUpdatedEvent) {
    return this.check(request, previous);
  }

  private async check(
    request: IVacationRequestViewModel,
    previous?: IVacationRequestViewModel,
  ) {
    const today = todayIso();

    if (!request.user || !coversDayOf(request, today)) {
      return;
    }

    if (
      previous &&
      coversDayOf(previous, today) &&
      previous.user_id === request.user_id
    ) {
      return;
    }

    await this.absenceCheckService.checkPerson(
      request.slack_team_id,
      request.user.slack_id,
    );
  }
}
