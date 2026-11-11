import { IUserViewModel } from '@modules/users/types/user.interface';
import { VacationRequestUpdatedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IRemovedVacationTime } from 'src/time-off-logging/types/vacation-time.types';

// A request edited or deleted by TimeOffChangesService. `removedTime`: the
// time logged from the request that the change removed, if it did.
export class TimeOffChangedEvent extends VacationRequestUpdatedEvent {
  public constructor(
    request: IVacationRequestViewModel,
    user: IUserViewModel,
    previous?: IVacationRequestViewModel,
    public readonly removedTime?: IRemovedVacationTime,
  ) {
    super(request, user, previous);
  }
}
