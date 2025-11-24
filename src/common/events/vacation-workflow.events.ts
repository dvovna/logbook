import { IVacationWorkflow } from '@common/types/vacation-workflow.types';

export class VacationWorkflowFinished {
  public constructor(public readonly workflow: IVacationWorkflow) {}
}
