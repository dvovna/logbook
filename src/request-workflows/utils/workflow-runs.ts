import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';

// The run a step belongs to. The first run of a request is named by the
// request's ID, which steps made before runs existed stand for too.
export const runOf = (step: IRequestWorkflowStepViewModel) =>
  step.step_data.run ?? step.request_id;

// The steps of the request's latest run: an edit closes a run and starts
// another, whose approvers decide on the request as it is now.
export const currentRunOf = <Step extends IRequestWorkflowStepViewModel>(
  steps: Step[],
): Step[] => {
  const latest = steps.reduce<Step | null>(
    (last, step) => (!last || step.created_at > last.created_at ? step : last),
    null,
  );

  return latest ? steps.filter((step) => runOf(step) === runOf(latest)) : [];
};
