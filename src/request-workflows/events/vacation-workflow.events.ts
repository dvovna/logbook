import { IVacationWorkflow } from '@modules/request-workflows/types/vacation-workflow.types';

export class VacationWorkflowFinished {
  public constructor(public readonly workflow: IVacationWorkflow) {}
}
