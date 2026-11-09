import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

@Injectable()
export class RequestWorkflowStepCommentsRepository extends SqlRepository<
  'request_workflow_step_comments',
  IWorkflowStepCommentViewModel
> {
  protected readonly tableName = 'request_workflow_step_comments';

  protected mapToViewModel = (
    row: SqlRow<'request_workflow_step_comments'>,
  ) => {
    return {
      id: row.id,
      request_id: row.request_id,
      slack_team_id: row.slack_team_id,
      slack_user_id: row.slack_user_id,
      comment: row.comment,
      step_level: row.step_level,
      step_id: row.step_id,
      created_by: row.created_by,
      created_at: row.created_at,
    } as IWorkflowStepCommentViewModel;
  };
}
