import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { sql } from 'kysely';
import { Json } from '@common/types/database.types';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';

@Injectable()
export class RequestWorkflowStepsRepository extends SqlRepository<
  'request_workflow_steps',
  IRequestWorkflowStepViewModel
> {
  protected readonly tableName = 'request_workflow_steps';

  protected mapToViewModel = (row: SqlRow<'request_workflow_steps'>) => {
    return {
      id: row.id,
      request_id: row.request_id,
      slack_team_id: row.slack_team_id,
      slack_user_id: row.slack_user_id,
      step_level: row.step_level,
      step_type: row.step_type as WorkflowStepType,
      slack_message_ts: row.slack_message_ts,
      slack_channel_id: row.slack_channel_id,
      step_data:
        row.step_data as unknown as IRequestWorkflowStepViewModel['step_data'],
      completed_at: row.completed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      processed_at: row.processed_at,
    } as IRequestWorkflowStepViewModel;
  };

  // Decides the request's open steps in one statement: all of them, one
  // level's, or one step. The status, who decided and when go into step_data,
  // and completed_at closes the step. Only open steps are touched, so of two
  // people who decide at once only the first changes anything: returns the
  // steps it decided, none when someone else was first.
  public async decide(params: {
    slackTeamId: string;
    requestId: string;
    status: string;
    decidedBySlackId: string;
    stepId?: string;
    stepLevel?: number;
  }): Promise<IRequestWorkflowStepViewModel[]> {
    const { stepId, stepLevel } = params;
    const rows = await this.updateInWorkspace(params.slackTeamId)
      .set({
        step_data: sql<NonNullable<Json>>`step_data || jsonb_build_object(
          'status', ${params.status}::text,
          'decided_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'decided_by_slack_id', ${params.decidedBySlackId}::text
        )`,
        completed_at: sql<string>`now()`,
        updated_at: sql<string>`now()`,
      })
      .where('request_id', '=', params.requestId)
      .where('completed_at', 'is', null)
      .$if(stepId !== undefined, (query) => query.where('id', '=', stepId!))
      .$if(stepLevel !== undefined, (query) =>
        query.where('step_level', '=', stepLevel!),
      )
      .returningAll()
      .execute();

    return rows.map(this.mapToViewModel);
  }
}
