import { formatDateRange } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock } from '@slack/web-api';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { VacationsTabViewActionId } from '@modules/slack/tabs/vacations/enums/vacations-tab-view-action-id.enum';
import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import * as pluralize from 'pluralize';

interface IGetViewParams extends IBaseTabViewParams {
  pendingRequestsCount: number;
  pendingRequests: IRequestWorkflowStepViewModel[];
  upcomingVacations: IVacationRequestViewModel[];
}

@Injectable()
export class VacationsTabView extends BaseAdminTabView<IGetViewParams, never> {
  protected activeTabActionId = AdminNavigationActionId.ManageVacations;
  protected callbackId = ViewCallbackId.VacationsTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*:palm_tree: Vacations*';
  }

  protected getContentBlocks({
    pendingRequests,
    upcomingVacations,
    pendingRequestsCount,
  }: IGetViewParams): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'plain_text',
        text: 'Manage vacation requests, balances, policies and holidays',
      },
    });

    blocks.push(...Divider.getBlocks());

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*⏳ Requests awaiting your approval${pendingRequestsCount > pendingRequests.length ? ` (${pendingRequests.length} of ${pendingRequestsCount})` : ''}*`,
      },
    });

    if (!pendingRequests.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '✅ No pending vacation requests',
        },
      });
    } else {
      pendingRequests.forEach((request) => {
        blocks.push(this.getPendingRequestBlock(request));
      });
    }

    blocks.push(...Divider.getBlocks());

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🟢 Approved & Upcoming vacations*',
      },
    });

    if (!upcomingVacations.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No upcoming vacations_',
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View all' },
          action_id: AdminNavigationActionId.ManageVacationRequests,
        },
      });
    } else {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: upcomingVacations
            .map(
              (request) =>
                `• *${escapeMrkdwn(request.user?.name || request.user?.email)}* — ${formatDateRange(request.start_date, request.end_date)}`,
            )
            .join('\n'),
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'View all' },
          action_id: AdminNavigationActionId.ManageVacationRequests,
        },
      });
    }

    blocks.push(...Divider.getBlocks());

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*📜 Policies & Holidays*\n\n' +
          'Configure vacation policies, yearly limits and public holidays',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Manage' },
        action_id: AdminNavigationActionId.ManageVacationPolicies,
      },
    });

    return blocks;
  }

  private getPendingRequestBlock(
    pendingRequest: IRequestWorkflowStepViewModel,
  ): AnyBlock {
    // The snapshot of the request: its requester, not the approver viewing it.
    const requestSnapshot = pendingRequest.step_data.snapshot;
    const requesterName =
      requestSnapshot.user_name || requestSnapshot.user_email;

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(requesterName)}* · ${VACATION_TYPE_DISPLAY_NAME_MAP[requestSnapshot.type]}
${formatDateRange(requestSnapshot.start_date, requestSnapshot.end_date)} (${pluralize('day', requestSnapshot.days, true)})`,
      },
      accessory: {
        type: 'overflow',
        action_id: VacationsTabViewActionId.ManagePendingRequestMenu,
        options: [
          {
            text: { type: 'plain_text', text: 'Approve & continue' },
            value: `${VacationsTabViewActionId.ApprovePendingRequest}:${pendingRequest.id}`,
          },
          {
            text: { type: 'plain_text', text: 'Add comment' },
            value: `${VacationsTabViewActionId.CommentPendingRequest}:${pendingRequest.id}`,
          },
          {
            text: { type: 'plain_text', text: 'View details' },
            value: `${VacationsTabViewActionId.ViewPendingRequestDetails}:${pendingRequest.request_id}`,
          },
          {
            text: {
              type: 'plain_text',
              text: 'Reject request',
            },
            value: `${VacationsTabViewActionId.RejectPendingRequest}:${pendingRequest.id}`,
          },
        ],
      },
    };
  }
}
