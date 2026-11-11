import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IUserViewModel } from '@modules/users/types/user.interface';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import {
  IVacationRequestFindParams,
  IVacationRequestUpdateParams,
} from '@modules/vacation-requests/types/vacation-request-params.types';
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
    const { previous, request, removedTime } =
      await this.transactions.transaction(async () => {
        await this.transactions.lock(vacationRequestLock(update.checked.id));

        const applied = await this.vacationRequestsService.applyUpdate(
          update,
          user,
        );

        return {
          ...applied,
          removedTime: changesLoggedTime(applied.previous, applied.request)
            ? await this.vacationTimeService.remove(
                applied.request.id,
                applied.request.slack_team_id,
                user,
              )
            : undefined,
        };
      });

    this.eventEmitter.emit(
      VacationRequestEvent.Updated,
      new TimeOffChangedEvent(request, user, previous, removedTime),
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

        return { request: current, removedTime: removed };
      },
    );

    this.eventEmitter.emit(
      VacationRequestEvent.Deleted,
      new TimeOffChangedEvent(request, user, undefined, removedTime),
    );

    return { request, billedDates: removedTime.billedDates };
  }
}
