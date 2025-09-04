import IVacationPolicyViewModel from '../types/vacation-policy.interface';

export class VacationPolicyCreatedEvent {
  public constructor(public readonly policy: IVacationPolicyViewModel) {}
}

export class VacationPolicyUpdatedEvent {
  public constructor(public readonly policy: IVacationPolicyViewModel) {}
}

export class VacationPolicyDeletedEvent {
  public constructor(public readonly policyId: string) {}
}
