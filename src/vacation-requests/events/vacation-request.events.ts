import { IVacationRequestViewModel } from '../types/vacation-request.interface';

export class VacationRequestCreatedEvent {
  public constructor(public readonly request: IVacationRequestViewModel) {}
}

export class VacationRequestUpdatedEvent {
  public constructor(public readonly request: IVacationRequestViewModel) {}
}

export class VacationRequestDeletedEvent {
  public constructor(public readonly requestId: string) {}
}
