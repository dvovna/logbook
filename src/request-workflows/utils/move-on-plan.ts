import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IAbsence } from '@modules/users/types/absence.interface';

type Step = IRequestWorkflowStepViewModel;

export interface IMoveOnInput {
  // The request's current run (currentRunOf), as it is now.
  steps: Step[];
  // The level it waits on; null: the request was just made.
  waitingOn: number | null;
  away: ReadonlyMap<string, IAbsence>;
  // Someone at work to make a fallback level of.
  fallbackAtWork: boolean;
}

export type MoveOnNext =
  // The level waited on still has someone at work.
  | { kind: 'wait' }
  | { kind: 'ask'; level: number; after: number | null }
  // The last level is done by an approval.
  | { kind: 'approve'; level: number }
  | { kind: 'fallback'; after: number | null };

export interface IMoveOnPlan {
  // Approved as their approver (#90). With ANY, the level's first, whose
  // decision closes the level.
  approveAs: Step[];
  skip: Step[];
  next: MoveOnNext;
}

const isApproved = (step: Step) =>
  step.step_data.status === WorkflowStepStatus.Approved;

// `after` is the last level done by an approval before the asked one, else
// `waitingOn`: the level the requester's notice reports on.
export const planMoveOn = ({
  steps,
  waitingOn,
  away,
  fallbackAtWork,
}: IMoveOnInput): IMoveOnPlan => {
  const approvers = new Set(
    steps
      .filter(isApproved)
      .map((step) => step.step_data.decided_by_slack_id ?? step.slack_user_id),
  );
  const levels = [
    ...new Set([
      ...(waitingOn === null ? [] : [waitingOn]),
      ...steps
        .filter(
          (step) => !step.completed_at && step.step_level > (waitingOn ?? 0),
        )
        .map((step) => step.step_level),
    ]),
  ].sort((a, b) => a - b);
  const approveAs: Step[] = [];
  const skip: Step[] = [];
  // Levels skipped with nobody's approval since the last level an approval
  // completed.
  let skipped: { level: number; steps: Step[]; open: boolean }[] = [];
  let after = waitingOn;

  for (const level of levels) {
    const atLevel = steps.filter((step) => step.step_level === level);
    let open = atLevel.filter((step) => !step.completed_at);
    let approved = atLevel.some(isApproved);

    if (level !== waitingOn) {
      const theirs = open.filter((step) => approvers.has(step.slack_user_id));
      const anyRule = theirs[0]?.step_data.rule === ApprovalRule.Any;

      approveAs.push(...(anyRule ? theirs.slice(0, 1) : theirs));
      open = anyRule ? [] : open.filter((step) => !theirs.includes(step));
      approved ||= theirs.length > 0;
    }

    const awayHere = open.filter((step) => away.has(step.slack_user_id));

    if (open.length > awayHere.length) {
      return {
        approveAs,
        skip: [...skip, ...skipped.flatMap((l) => l.steps), ...awayHere],
        next:
          level === waitingOn
            ? { kind: 'wait' }
            : { kind: 'ask', level, after },
      };
    }

    if (approved) {
      skip.push(...skipped.flatMap((l) => l.steps), ...awayHere);
      skipped = [];
      after = level;
    } else {
      skipped.push({ level, steps: awayHere, open: open.length > 0 });
    }
  }

  if (!skipped.length) {
    return {
      approveAs,
      skip,
      next: { kind: 'approve', level: levels[levels.length - 1] },
    };
  }

  if (fallbackAtWork) {
    return {
      approveAs,
      skip: [...skip, ...skipped.flatMap((l) => l.steps)],
      next: { kind: 'fallback', after },
    };
  }

  // Nobody who could take it is at work: no skip that leaves it waiting only
  // for people who are away.
  const first = skipped.find((l) => l.open);

  return {
    approveAs,
    skip,
    next: !first
      ? { kind: 'fallback', after }
      : first.level === waitingOn
        ? { kind: 'wait' }
        : { kind: 'ask', level: first.level, after },
  };
};
