import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export class VacationRequestCreatedEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly user: IUserViewModel,
  ) {}
}

export class VacationRequestUpdatedEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly user: IUserViewModel,
  ) {}
}

export class VacationRequestDeletedEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly user: IUserViewModel,
  ) {}
}

export class VacationRequestDecidedEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly decidedBy: IUserViewModel,
    public readonly comments: IWorkflowStepCommentViewModel[],
  ) {}
}
