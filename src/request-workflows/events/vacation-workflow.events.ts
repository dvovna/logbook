import { IVacationWorkflow } from '@modules/request-workflows/types/vacation-workflow.types';

export class VacationWorkflowFinished {
  public constructor(public readonly workflow: IVacationWorkflow) {}
}

export class VacationWorkflowLevelCompleted {
  public constructor(
    public readonly requestId: string,
    public readonly slackTeamId: string,
    public readonly level: number,
    // The level asked now: a level left with nobody is passed over.
    public readonly nextLevel: number,
  ) {}
}
