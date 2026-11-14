import { IVacationWorkflow } from '@modules/request-workflows/types/vacation-workflow.types';

export class VacationWorkflowFinished {
  public constructor(public readonly workflow: IVacationWorkflow) {}
}

export class VacationWorkflowLevelCompleted {
  public constructor(
    public readonly requestId: string,
    public readonly slackTeamId: string,
    public readonly level: number,
    // The level asked now: a level left with nobody, or whose approvers were
    // all skipped, is passed over; a fallback level is one above the highest.
    public readonly nextLevel: number,
    // The steps this move skipped, of approvers on time off.
    public readonly skippedStepIds: string[] = [],
  ) {}
}
