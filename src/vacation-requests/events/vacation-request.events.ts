import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserRole from '@common/enums/user-role.enum';

export class VacationRequestCreatedEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly user: IUserViewModel,
  ) {}
}

export class VacationRequestUpdatedEvent {
  // `previous` is the request as it was before an edit. The workflow's
  // outcome (`finishPending`) passes none: it has a decision event of its own.
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly user: IUserViewModel,
    public readonly previous?: IVacationRequestViewModel,
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
  ) {}
}

// Nobody the requester's rules name can approve the request: their team, or
// the company rules for someone in no team, name no approvers besides them.
// It went to everyone with `sentTo` (HR, else admins), or to nobody when that
// is null.
export interface IApprovalFallback {
  inTeam: boolean;
  // Level 2 came from the company rules (always, for someone in no team).
  followsCompanyRules: boolean;
  sentTo: UserRole.HR | UserRole.Admin | null;
}

// A pending request's approval workflow started. `fallback` is null when the
// approvers its rules name have it.
export class VacationRequestSentForApprovalEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly fallback: IApprovalFallback | null,
  ) {}
}
