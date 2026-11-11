import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import UserRole from '@common/enums/user-role.enum';
import { JobsService } from '@common/jobs/jobs.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import {
  USER_ACCESS_CHANGED,
  UserAccessChangedEvent,
} from '@modules/users/events/users.events';
import { UsersService } from '@modules/users/services/users.service';
import { canApprove } from '@modules/users/utils/approver-roles';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';

export const APPROVER_ACCESS_JOB = 'workflow-approver-access';

interface IApproverAccessJob {
  userId: string;
  slackTeamId: string;
}

// Someone deactivated or left without an approving role can't decide the
// steps waiting for them: those close, and the requests move on
// (RequestWorkflowService.dropApprover). A job, so that no request is left
// waiting when it fails; safe to run again, as closed steps stay closed.
@Injectable()
export class ApproverAccessService implements OnModuleInit {
  public constructor(
    private readonly usersService: UsersService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IApproverAccessJob>(APPROVER_ACCESS_JOB, (job) =>
      this.handOver(job),
    );
  }

  @OnEvent(USER_ACCESS_CHANGED)
  public handleAccessChanged({ userId, slackTeamId }: UserAccessChangedEvent) {
    this.jobs.run<IApproverAccessJob>(APPROVER_ACCESS_JOB, {
      userId,
      slackTeamId,
    });
  }

  private async handOver({ userId, slackTeamId }: IApproverAccessJob) {
    const user = await this.usersService.findOne({
      id: userId,
      slackTeamId,
      includeInactive: true,
    });

    if (!user || canApprove(user)) {
      return;
    }

    const steps = await this.requestWorkflowStepsService.findMany({
      slackUserId: user.slack_id,
      slackTeamId,
      completed: false,
    });

    if (!steps.length) {
      return;
    }

    const hrAndAdmins = await this.usersService.findMany({
      slackTeamId,
      roles: [UserRole.HR, UserRole.Admin],
    });

    for (const requestId of new Set(steps.map((step) => step.request_id))) {
      const { snapshot } = steps.find(
        (step) => step.request_id === requestId,
      )!.step_data;
      const fallback = fallbackApprovers(hrAndAdmins, snapshot.user_id);

      await this.requestWorkflowService.dropApprover(
        requestId,
        slackTeamId,
        user,
        fallback && {
          slackIds: fallback.approvers.map(({ slack_id }) => slack_id),
          levelName:
            fallback.role === UserRole.HR ? 'HR approval' : 'Admin approval',
        },
      );
    }
  }
}
