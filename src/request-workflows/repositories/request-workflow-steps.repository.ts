import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { sql } from 'kysely';
import { Json } from '@common/types/database.types';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';

export interface IStuckStep {
  request_id: string;
  start_date: string;
  end_date: string;
  requester_id: string;
  requester_name: string;
  requester_email: string | null;
  approver_slack_id: string | null;
  approver_name: string | null;
  approver_email: string | null;
  asked_at: string;
}

@Injectable()
export class RequestWorkflowStepsRepository extends BaseRepository<
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
    // Several: all their open steps (many requests closed at once).
    requestId: string | string[];
    status: string;
    decidedBySlackId: string;
    // Kept with the steps, so every approver's message shows it.
    rejectionReason?: string;
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
        ) || ${
          params.rejectionReason
            ? sql`jsonb_build_object('rejection_reason', ${params.rejectionReason}::text)`
            : sql`'{}'::jsonb`
        }`,
        completed_at: sql<string>`now()`,
        updated_at: sql<string>`now()`,
      })
      .where((eb) =>
        typeof params.requestId === 'string'
          ? eb('request_id', '=', params.requestId)
          : eb('request_id', '=', eb.fn.any(eb.val(params.requestId))),
      )
      .where('completed_at', 'is', null)
      .$if(stepId !== undefined, (query) => query.where('id', '=', stepId!))
      .$if(stepLevel !== undefined, (query) =>
        query.where('step_level', '=', stepLevel!),
      )
      .returningAll()
      .execute();

    return rows.map(this.mapToViewModel);
  }

  // The open steps that wait for the approver `slackUserId`, oldest first,
  // but those of their own request (RequestWorkflowStepsService.findWaitingFor).
  public async findWaitingFor(
    slackTeamId: string,
    slackUserId: string,
  ): Promise<IRequestWorkflowStepViewModel[]> {
    const rows = await this.waitingFor(slackTeamId, slackUserId)
      .selectAll()
      .orderBy('created_at')
      .orderBy('id')
      .execute();

    return rows.map(this.mapToViewModel);
  }

  public async countWaitingFor(
    slackTeamId: string,
    slackUserId: string,
  ): Promise<number> {
    const { count } = await this.waitingFor(slackTeamId, slackUserId)
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .executeTakeFirstOrThrow();

    return Number(count);
  }

  // How many of the steps countWaitingFor counts were asked before
  // `before`, and when the oldest of them was.
  public async summarizeWaitingSince(
    slackTeamId: string,
    slackUserId: string,
    before: Date,
  ): Promise<{ count: number; oldest: string | null }> {
    const { count, oldest } = await this.waitingFor(
      slackTeamId,
      slackUserId,
      before,
    )
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.min('processed_at').as('oldest'),
      ])
      .executeTakeFirstOrThrow();

    return { count: Number(count), oldest: (oldest as string | null) ?? null };
  }

  // The approvers of the open steps asked before `before` (openSteps).
  public async findApproversWaitingSince(
    slackTeamId: string,
    before: Date,
  ): Promise<string[]> {
    const rows = await this.openSteps(slackTeamId, before)
      .select('slack_user_id')
      .distinct()
      .execute();

    return rows.flatMap(({ slack_user_id }) =>
      slack_user_id ? [slack_user_id] : [],
    );
  }

  // The open steps asked before `before` (openSteps), with the request, its
  // requester and the approver: what HR may decide for an approver who is
  // away.
  public async findStuckSince(
    slackTeamId: string,
    before: Date,
  ): Promise<IStuckStep[]> {
    return this.openSteps(slackTeamId, before)
      .innerJoin(
        'vacation_requests as request',
        'request.id',
        'request_workflow_steps.request_id',
      )
      .innerJoin('users as requester', 'requester.id', 'request.user_id')
      .leftJoin('users as approver', (join) =>
        join
          .onRef(
            'approver.slack_id',
            '=',
            'request_workflow_steps.slack_user_id',
          )
          .onRef(
            'approver.slack_team_id',
            '=',
            'request_workflow_steps.slack_team_id',
          ),
      )
      .select([
        'request.id as request_id',
        'request.start_date',
        'request.end_date',
        'requester.id as requester_id',
        'requester.name as requester_name',
        'requester.email as requester_email',
        'request_workflow_steps.slack_user_id as approver_slack_id',
        'approver.name as approver_name',
        'approver.email as approver_email',
        'request_workflow_steps.processed_at as asked_at',
      ])
      .orderBy('request_workflow_steps.processed_at')
      .execute() as Promise<IStuckStep[]>;
  }

  // The open steps that wait for `slackUserId` (asked before
  // `askedBefore`, when given).
  private waitingFor(
    slackTeamId: string,
    slackUserId: string,
    askedBefore?: Date,
  ) {
    return this.openSteps(slackTeamId, askedBefore).where(
      'request_workflow_steps.slack_user_id',
      '=',
      slackUserId,
    );
  }

  // The steps whose approver was asked (before `askedBefore`, when given)
  // and hasn't decided, but those of the approver's own request: what waits
  // for an approver, the one rule of the Approvals count, the inbox and the
  // reminders.
  private openSteps(slackTeamId: string, askedBefore?: Date) {
    return this.selectInWorkspace(slackTeamId)
      .where('request_workflow_steps.processed_at', 'is not', null)
      .where('request_workflow_steps.completed_at', 'is', null)
      .where(
        sql<boolean>`"request_workflow_steps"."step_data" -> 'snapshot' ->> 'slack_user_id' is distinct from "request_workflow_steps"."slack_user_id"`,
      )
      .$if(!!askedBefore, (query) =>
        query.where(
          'request_workflow_steps.processed_at',
          '<',
          askedBefore!.toISOString(),
        ),
      );
  }
}
