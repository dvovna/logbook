import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { Injectable } from '@nestjs/common';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { Divider } from '@modules/slack/common/views/components/separator';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { getDisplayTime } from '@common/utils/time.utils';
import { IWorkspaceTimeSummary } from 'src/time-entries/services/time-entries-summary.service';

interface IGetViewParams extends IBaseTabViewParams {
  // Submitted entries waiting for the viewer's decision.
  pendingApprovals: number;
  weekSummary: IWorkspaceTimeSummary;
}

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

@Injectable()
export class TimeAndBillingTabView extends BaseAdminTabView<
  IGetViewParams,
  never
> {
  protected activeTabActionId = AdminNavigationActionId.ManageTimeAndBilling;
  protected callbackId = ViewCallbackId.TimeAndBillingTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle(): string {
    return '*🕒 Time & Billing*';
  }

  protected getContentBlocks({
    pendingApprovals,
    weekSummary,
    userRole,
  }: IGetViewParams): AnyBlock[] {
    const can = (actionId: AdminNavigationActionId) =>
      this.slackActionPermissionsService.can(userRole, actionId);

    return [
      {
        type: 'section',
        text: {
          type: 'plain_text',
          text: 'Manage time tracking, projects, clients and billing reports.',
        },
      },
      ...Divider.getBlocks(),
      this.buildManageBlock(
        '🏢 Clients',
        'Manage customers and billing entities',
        AdminNavigationActionId.ManageClients,
      ),
      this.buildManageBlock(
        '📁 Projects',
        'Projects, teams and assignments',
        AdminNavigationActionId.ManageProjects,
      ),
      this.buildManageBlock(
        '⏱ Time logs',
        'View and manage logged work time',
        AdminNavigationActionId.ManageTimeLogs,
      ),
      ...(can(AdminNavigationActionId.ManageTimeApprovals)
        ? [
            this.buildManageBlock(
              `✅ Approvals${pendingApprovals ? ` (${pendingApprovals})` : ''}`,
              'Submitted time entries waiting for your decision',
              AdminNavigationActionId.ManageTimeApprovals,
            ),
          ]
        : []),
      ...(can(AdminNavigationActionId.ManageBillingReports)
        ? [
            this.buildManageBlock(
              '📊 Billing reports',
              'Approved hours by client, project and person',
              AdminNavigationActionId.ManageBillingReports,
            ),
          ]
        : []),
      ...Divider.getBlocks(),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📈 This week snapshot*',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: [
            `• *${hours(weekSummary.weekMinutes)}* logged total`,
            `• *${hours(weekSummary.weekBillableMinutes)}* billable`,
            `• *${weekSummary.activeProjects}* active projects`,
          ].join('\n'),
        },
      },
    ];
  }

  private buildManageBlock(
    title: string,
    description: string,
    actionId: AdminNavigationActionId,
  ): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${title}*\n\n${description}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Manage' },
        action_id: actionId,
      },
    };
  }
}
