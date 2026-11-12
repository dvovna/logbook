import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import {
  IVacationRequestFindParams,
  IVacationRequestUpdateParams,
} from '@modules/vacation-requests/types/vacation-request-params.types';
import { decidesRequest } from '@modules/vacation-requests/utils/request-decision.utils';
import { vacationRequestLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { TimeOffChangedEvent } from 'src/time-off-logging/events/time-off.events';
import { VacationTimeService } from 'src/time-off-logging/services/vacation-time.service';
import { IVacationRequestChange } from 'src/time-off-logging/types/time-off-change.types';
import { changesLoggedTime } from 'src/time-off-logging/utils/vacation-time.utils';

// HR's and admins' edits and deletions of a request, which take the time
// logged from it along, but for billed days, in the same transaction.
@Injectable()
export class TimeOffChangesService {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationTimeService: VacationTimeService,
    private readonly transactions: TransactionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // The time goes when the edit changes what it was made of
  // (changesLoggedTime), compared with the request as applyUpdate found it
  // under the lock.
  public async update(
    findParams: IVacationRequestFindParams,
    changes: IVacationRequestUpdateParams,
    user: IUserViewModel,
  ): Promise<IVacationRequestChange> {
    const update = await this.vacationRequestsService.checkUpdate(
      findParams,
      changes,
      user,
    );
    const { request, removedTime } = await this.transactions.transaction(
      async () => {
        await this.transactions.lock(vacationRequestLock(update.checked.id));

        const applied = await this.vacationRequestsService.applyUpdate(
          update,
          user,
        );
        const removed = changesLoggedTime(applied.previous, applied.request)
          ? await this.vacationTimeService.remove(
              applied.request.id,
              applied.request.slack_team_id,
              user,
            )
          : undefined;

        // Inside the transaction: the listeners close the approvers' steps
        // and save the jobs that follow the edit (a new approval, offers,
        // what time went) with it.
        await this.eventEmitter.emitAsync(
          VacationRequestEvent.Updated,
          new TimeOffChangedEvent(
            applied.request,
            user,
            applied.previous,
            removed,
          ),
        );

        // Approving or rejecting it here decides it, by the editor: the
        // requester and the recipients hear of it as of the workflow's
        // decision. Compared with the request under the lock, so a second
        // submit of the form decides nothing again.
        if (decidesRequest(applied.previous, applied.request)) {
          await this.eventEmitter.emitAsync(
            VacationRequestEvent.Decided,
            new VacationRequestDecidedEvent(applied.request, user),
          );
        }

        return { request: applied.request, removedTime: removed };
      },
    );

    return { request, billedDates: removedTime?.billedDates ?? [] };
  }

  public async delete(
    { id, slackTeamId }: { id: string; slackTeamId: string },
    user: IUserViewModel,
  ): Promise<IVacationRequestChange> {
    const { request, removedTime } = await this.transactions.transaction(
      async () => {
        await this.transactions.lock(vacationRequestLock(id));

        // Read under the lock: the event and the removal DM tell of the
        // request as it was deleted, not as it was before a concurrent edit.
        const current =
          await this.vacationRequestsService.findOneWithValidation({
            id,
            slackTeamId,
          });
        // Before the request goes: deleting it unlinks its entries.
        const removed = await this.vacationTimeService.remove(
          id,
          slackTeamId,
          user,
        );

        await this.vacationRequestsService.applyDelete(current, user);

        // The DMs telling what time went are saved with the delete.
        await this.eventEmitter.emitAsync(
          VacationRequestEvent.Deleted,
          new TimeOffChangedEvent(current, user, undefined, removed),
        );

        return { request: current, removedTime: removed };
      },
    );

    return { request, billedDates: removedTime.billedDates };
  }
}
