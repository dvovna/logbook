import { IVacationWorkflow } from 'src/common/types/vacation-workflow.types';

export class VacationWorkflowFinished {
  public constructor(public readonly workflow: IVacationWorkflow) {}
}
