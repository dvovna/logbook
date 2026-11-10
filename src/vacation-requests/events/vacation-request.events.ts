import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import UserRole from '@common/enums/user-role.enum';

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

// Nobody on the requester's team can approve the request: they are in no
// team, or their team names no approvers besides them. It went to everyone
// with `sentTo` (HR, else admins), or to nobody when that is null.
export interface IApprovalFallback {
  inTeam: boolean;
  sentTo: UserRole.HR | UserRole.Admin | null;
}

// A pending request's approval workflow started. `fallback` is null when the
// team's approvers have it.
export class VacationRequestSentForApprovalEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly fallback: IApprovalFallback | null,
  ) {}
}
