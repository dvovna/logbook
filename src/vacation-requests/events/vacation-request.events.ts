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

// A request nobody on the requester's team can approve: they are in no team,
// or their team names no approvers besides them. It went to everyone with
// `sentTo` (HR, else admins), or to nobody when that is null.
export class VacationRequestWithoutTeamApproversEvent {
  public constructor(
    public readonly request: IVacationRequestViewModel,
    public readonly inTeam: boolean,
    public readonly sentTo: UserRole.HR | UserRole.Admin | null,
  ) {}
}
