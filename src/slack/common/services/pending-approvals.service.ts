import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import {
  canOpenScreen,
  ScreenId,
} from '@modules/slack/common/navigation/screens';

export interface IPendingApprovals {
  // Time off requests: the viewer's open approval steps.
  timeOff: number;
  // Submitted time entries the viewer decides on.
  timeEntries: number;
}

// What waits for the viewer's decision: shown on the Approvals button and
// on Home.
@Injectable()
export class PendingApprovalsService {
  public constructor(
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
  ) {}

  public async count(user: IUserViewModel): Promise<IPendingApprovals> {
    if (!canOpenScreen(ScreenId.Approvals, user.role)) {
      return { timeOff: 0, timeEntries: 0 };
    }

    const [timeOff, timeEntries] = await Promise.all([
      this.requestWorkflowStepsService.count({
        slackUserId: user.slack_id,
        slackTeamId: user.slack_team_id,
        processed: true,
        completed: false,
      }),
      this.timeEntryApprovalsService.countPending(user),
    ]);

    return { timeOff, timeEntries };
  }
}
