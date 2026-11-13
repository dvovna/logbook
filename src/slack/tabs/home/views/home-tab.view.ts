import {
  VACATION_TYPE_LABELS,
  vacationTypeLabel,
} from '@modules/slack/common/views/data/labels';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { formatDateRange, formatDayMonth } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import { monthLabel } from '@modules/receipts/utils/receipt-months';
import { IReceiptsHomeSummary } from 'src/receipts/services/receipts-home.service';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IVacationPeriodUsageData } from '@modules/vacation-requests/types/user-vacations-usage-info.interface';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import VacationType from '@common/enums/vacation-type.enum';
import pluralize from 'pluralize';
import { Divider } from '@modules/slack/common/views/components/separator';
import { getDisplayTime } from '@common/utils/time.utils';
import { IUserTimeSummary } from 'src/time-entries/services/time-entries-summary.service';
import { IPendingApprovals } from '@modules/slack/common/services/pending-approvals.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { ISetupProgress } from '@modules/slack/tabs/home/types/setup-progress.interface';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import {
  correctionDetails,
  fileBalanceLine,
} from '@modules/slack/common/views/data/leave-balance.text';

interface IGetViewParams extends IBaseTabViewParams {
  vacationUsageInfo: IVacationPeriodUsageData | null;
  // The person's balance from a file, named under their annual leave.
  fileBalance: ILeaveBalance | null;
  requestedVacations?: IVacationRequestViewModel[];
  timeSummary: IUserTimeSummary;
  pendingApprovals: IPendingApprovals;
  // The setup checklist, for Admin and HR until the workspace is set up.
  setup: ISetupProgress | null;
  // What the workspace collects receipts for, null when nothing.
  receipts: IReceiptsHomeSummary | null;
}

// The setup checklist's blocks: `setup`, `setup_done`, `setup_<step>`.
export const SETUP_BLOCK_ID = 'setup';

export enum HomeTabActionId {
  OpenVacationModal = 'open_vacation_modal',
  CancelRequest = 'cancel_vacation_request',
  ViewDetails = 'view_vacation_request_details',
  ManagePendingRequestMenu = 'manage_pending_request_menu',
  LogTime = 'log_time',
  EditTimeEntries = 'edit_time_entries',
  SubmitTimeEntries = 'submit_time_entries_from_home',
  Reminders = 'open_receipt_reminders',
}

@Injectable()
export class HomeTabView extends BaseTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.HomeTabView;

  public constructor(
    protected readonly slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  public getContentBlocks({
    vacationUsageInfo,
    fileBalance,
    requestedVacations,
    timeSummary,
    pendingApprovals,
    setup,
    receipts,
  }: IGetViewParams) {
    return [
      ...(setup ? this.getSetupBlocks(setup) : []),
      ...this.getAttentionBlocks(pendingApprovals),
      ...this.getUserViewBlocks(
        vacationUsageInfo,
        fileBalance,
        timeSummary,
        requestedVacations,
      ),
      ...(receipts ? this.getReceiptsBlocks(receipts) : []),
    ];
  }

  protected getTabTitle() {
    return `*${SCREENS[ScreenId.Home].title}*`;
  }

  // What is left to set up: how many required steps are done, the done
  // ones in one line, then each step left with why it matters and the
  // button to the screen that does it.
  private getSetupBlocks({
    hasPolicy,
    hasCompanyApprovers,
    hasTeamWithApprovers,
    companyRulesNameApprovers,
    peopleWithoutTeam,
    hasProjects,
    hasLeaveImport,
  }: ISetupProgress): AnyBlock[] {
    const steps = [
      {
        key: 'policy',
        done: hasPolicy,
        title: 'Create a vacation policy',
        why: "Days per year and public holidays. Without one, balances aren't checked.",
        doneLabel: 'vacation policy',
        buttons: [
          { text: 'Open Policies', actionId: NavigationActionId.Policies },
        ],
      },
      {
        key: 'rules',
        done: hasCompanyApprovers,
        title: 'Set the company rules',
        why: 'Who approves after the team lead, who hears of decisions, and the policy teams follow.',
        doneLabel: 'company rules',
        buttons: [
          {
            text: 'Company rules',
            actionId: TeamsTabViewActionId.CompanyRules,
          },
        ],
      },
      {
        key: 'team',
        done: hasTeamWithApprovers,
        title: 'Create teams and pick their approvers',
        why: "A team's approvers decide time off for its people. The team file sets up everyone at once.",
        doneLabel: 'team with approvers',
        buttons: [
          {
            text: '📄 Set up from a file',
            actionId: TeamsTabViewActionId.TeamFile,
          },
          { text: 'Teams', actionId: NavigationActionId.Teams },
        ],
      },
      {
        key: 'people',
        done: peopleWithoutTeam === 0,
        title: 'Put people in teams',
        why: `${pluralize('person', peopleWithoutTeam, true)} ${peopleWithoutTeam === 1 ? 'has' : 'have'} no team: their requests ${companyRulesNameApprovers ? "skip level 1 and go to the company rules' approvers, or to HR or the admins when none of them can approve" : 'go to HR or the admins'}.`,
        doneLabel: 'everyone in a team',
        buttons: [{ text: 'Open People', actionId: NavigationActionId.People }],
      },
      {
        key: 'leave',
        optional: true,
        done: hasLeaveImport,
        title: 'Bring in leave balances',
        why: 'Balances and past leave from your spreadsheet, so everyone starts with the right number.',
        doneLabel: 'leave balances',
        buttons: [
          {
            text: '📥 Import leave',
            actionId: UsersTabViewActionId.ImportLeave,
          },
        ],
      },
      {
        key: 'projects',
        optional: true,
        done: hasProjects,
        title: 'Add projects',
        why: 'Only if you track time: people log hours on them.',
        doneLabel: 'projects',
        buttons: [
          { text: 'Open Projects', actionId: NavigationActionId.Projects },
        ],
      },
    ];
    const required = steps.filter(({ optional }) => !optional);
    const done = steps.filter((step) => step.done);

    return [
      {
        type: 'section',
        block_id: SETUP_BLOCK_ID,
        text: {
          type: 'mrkdwn',
          text: `*🚀 Set up Logbook* · ${required.filter((step) => step.done).length} of ${required.length} done`,
        },
      },
      ...(done.length
        ? [
            {
              type: 'context' as const,
              block_id: `${SETUP_BLOCK_ID}_done`,
              elements: [
                {
                  type: 'mrkdwn' as const,
                  text: `✅ Done: ${done.map(({ doneLabel }) => doneLabel).join(', ')}`,
                },
              ],
            },
          ]
        : []),
      ...steps
        .filter((step) => !step.done)
        .flatMap(({ key, optional, title, why, buttons }): AnyBlock[] => {
          const toButton = ({ text, actionId }: (typeof buttons)[number]) => ({
            type: 'button' as const,
            text: { type: 'plain_text' as const, text },
            action_id: actionId,
          });
          const text = {
            type: 'mrkdwn' as const,
            text: `*${title}*${optional ? ' · _optional_' : ''}\n${why}`,
          };

          // A section holds one button; with more they go in a row below.
          return buttons.length === 1
            ? [
                {
                  type: 'section',
                  block_id: `${SETUP_BLOCK_ID}_${key}`,
                  text,
                  accessory: toButton(buttons[0]),
                },
              ]
            : [
                {
                  type: 'section',
                  block_id: `${SETUP_BLOCK_ID}_${key}`,
                  text,
                },
                {
                  type: 'actions',
                  block_id: `${SETUP_BLOCK_ID}_${key}_buttons`,
                  elements: buttons.map(toButton),
                },
              ];
        }),
      ...Divider.getBlocks(),
    ];
  }

  // What was sent for each reimbursement being collected, and when it is
  // due.
  private getReceiptsBlocks({
    lines,
    drafts,
    remindersOff,
    currency,
  }: IReceiptsHomeSummary): AnyBlock[] {
    const section = (text: string): AnyBlock => ({
      type: 'section',
      text: { type: 'mrkdwn', text },
    });

    return [
      ...Divider.getBlocks(),
      section('*🧾 Receipts*'),
      ...(remindersOff ? [section('You turned receipt reminders off.')] : []),
      ...lines.map(({ reimbursementName, month, count, totalCents, dueDate }) =>
        section(
          `${escapeMrkdwn(reimbursementName)} · ${monthLabel(month)}: ${
            count
              ? `${pluralize('receipt', count, true)}, ${formatMoney(totalCents, currency)}`
              : 'nothing sent yet'
          } · due ${formatDayMonth(dueDate)}`,
        ),
      ),
      ...(drafts
        ? [
            section(
              `${pluralize('receipt', drafts, true)} ${drafts === 1 ? 'needs' : 'need'} details`,
            ),
          ]
        : []),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'My receipts' },
            action_id: NavigationActionId.MyReceipts,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔔 Reminders', emoji: true },
            action_id: HomeTabActionId.Reminders,
          },
        ],
      },
    ];
  }

  // What waits for the viewer's decision, for those who approve.
  private getAttentionBlocks({
    timeOff,
    timeEntries,
  }: IPendingApprovals): AnyBlock[] {
    if (!timeOff && !timeEntries) {
      return [];
    }

    const waiting = [
      timeOff && pluralize('time off request', timeOff, true),
      timeEntries && pluralize('time entry', timeEntries, true),
    ].filter(Boolean);

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⏳ Needs your attention*\n${waiting.join(' and ')} ${timeOff + timeEntries === 1 ? 'waits' : 'wait'} for your decision.`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Open Approvals' },
          action_id: NavigationActionId.Approvals,
        },
      },
      ...Divider.getBlocks(),
    ];
  }

  private getUserViewBlocks(
    usageInfo: IVacationPeriodUsageData | null,
    fileBalance: ILeaveBalance | null,
    timeSummary: IUserTimeSummary,
    requestedVacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'plain_text',
          text: 'Your personal work & vacation overview',
        },
      },
      ...Divider.getBlocks(),
      ...this.getTimeTrackingBlocks(timeSummary),
      ...this.getVacationUsageBlocks(usageInfo, fileBalance),
      ...this.getRequestedVacationsBlocks(requestedVacations),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🌴 Request time off' },
            action_id: HomeTabActionId.OpenVacationModal,
          },
        ],
      },
    ];
  }

  private buildAnnualLeaveBlock(
    usage: IVacationPeriodUsageData['usage']['annual_leave'],
    limits: IVacationPeriodUsageData['limits'],
  ) {
    const usedDays = usage.used ?? 0;
    const workingUsed = usage.working_days_used ?? 0;

    // Without a vacation policy (the team's or the company rules') nothing is
    // limited: there is no balance to show, only what was taken.
    if (!limits) {
      return this.unlimitedLeaveBlock(
        VACATION_TYPE_LABELS[VacationType.AnnualLeave].balance,
        usedDays,
      );
    }

    const details: string[] = [];

    if (usedDays > 0) {
      details.push(`*${usedDays}* used`);
    }

    if (workingUsed > 0 && workingUsed !== usedDays) {
      details.push(`*${workingUsed}* working`);
    }

    if (limits.carryoverDays > 0) {
      details.push(`+*${limits.carryoverDays}* carryover`);
    }

    details.push(
      ...correctionDetails(limits.correction, {
        days: true,
        workingDays: true,
      }),
    );

    const detailsText = details.length ? ` (${details.join(', ')})` : '';

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${VACATION_TYPE_LABELS[VacationType.AnnualLeave].balance}: *${usage.available ?? 0} available* / ${limits.vacationDays} total${detailsText}`,
      },
    } as AnyBlock;
  }

  private unlimitedLeaveBlock(title: string, used: number): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${title}: ${used > 0 ? `*${used}* used · ` : ''}no limit (no vacation policy applies to you)`,
      },
    };
  }

  private buildBonusDaysBlock(
    usage: IVacationPeriodUsageData['usage']['bonus_day'],
    limits: IVacationPeriodUsageData['limits'],
  ) {
    const used = usage.used ?? 0;

    if (!limits) {
      return this.unlimitedLeaveBlock(
        VACATION_TYPE_LABELS[VacationType.BonusDay].balance,
        used,
      );
    }

    const details = [
      ...(used > 0 ? [`*${used}* used`] : []),
      ...correctionDetails(limits.correction, { bonusDays: true }),
    ];
    const detailsText = details.length ? ` (${details.join(', ')})` : '';

    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${VACATION_TYPE_LABELS[VacationType.BonusDay].balance}: *${usage.available ?? 0} available* / ${limits.bonusDays} total${detailsText}`,
      },
    } as AnyBlock;
  }

  private getVacationUsageBlocks(
    vacationsUsageInfo: IVacationPeriodUsageData | null,
    fileBalance: ILeaveBalance | null,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [
      ...Divider.getBlocks(),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🏝 Vacation Usage*' },
      },
    ];

    if (!vacationsUsageInfo) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No vacation usage data available._',
        },
      });

      return blocks;
    }

    blocks.push(
      this.buildAnnualLeaveBlock(
        vacationsUsageInfo.usage.annual_leave,
        vacationsUsageInfo.limits,
      ),
    );

    if (fileBalance && vacationsUsageInfo.limits?.correction) {
      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: fileBalanceLine(fileBalance) }],
      });
    }

    if (
      vacationsUsageInfo.usage.bonus_day.used > 0 ||
      vacationsUsageInfo.usage.bonus_day.available > 0
    ) {
      blocks.push(
        this.buildBonusDaysBlock(
          vacationsUsageInfo.usage.bonus_day,
          vacationsUsageInfo.limits,
        ),
      );
    }

    [
      VacationType.SickLeave,
      VacationType.UnpaidLeave,
      VacationType.Other,
    ].forEach((type) => {
      const leave =
        vacationsUsageInfo.usage[type as keyof typeof vacationsUsageInfo.usage];

      if (leave.used > 0) {
        const title = VACATION_TYPE_LABELS[type].balance;

        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${title}: *${leave.used}* used`,
          },
        });
      }
    });

    return blocks;
  }

  private buildVacationBlock(vacation: IVacationRequestViewModel): AnyBlock {
    return {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${vacationTypeLabel(vacation.type)}*\n${formatDateRange(vacation.start_date, vacation.end_date)} (${pluralize('day', vacation.days, true)})`,
      },
      accessory: {
        type: 'overflow',
        action_id: HomeTabActionId.ManagePendingRequestMenu,
        options: [
          {
            text: { type: 'plain_text', text: '📋 View Details' },
            value: `${HomeTabActionId.ViewDetails}:${vacation.id}`,
          },
          {
            text: { type: 'plain_text', text: '❌ Cancel' },
            value: `${HomeTabActionId.CancelRequest}:${vacation.id}`,
          },
        ],
      },
    } as AnyBlock;
  }

  private getRequestedVacationsBlocks(
    vacations?: IVacationRequestViewModel[],
  ): AnyBlock[] {
    if (!vacations?.length) {
      return [];
    }

    return [
      ...Divider.getBlocks(),
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🗓 Your Pending Vacation Requests*' },
      },
      ...vacations.map((data) => this.buildVacationBlock(data)),
    ];
  }

  private getTimeTrackingBlocks({
    todayMinutes,
    todayByClient,
    weekMinutes,
    unsubmitted,
  }: IUserTimeSummary): AnyBlock[] {
    const clients = todayByClient
      .map(
        ({ clientName, minutes }) =>
          `${clientName ? escapeMrkdwn(clientName) : 'No client'} ${getDisplayTime(minutes)}`,
      )
      .join(', ');

    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*🕒 Time Tracking*' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: todayMinutes
            ? `Today: *${getDisplayTime(todayMinutes)}* (${clients})`
            : 'Today: nothing logged yet',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `This week: *${weekMinutes ? getDisplayTime(weekMinutes) : '0h'}* total`,
        },
      },
      // Logged time reaches the approvers only once it is submitted.
      ...(unsubmitted.count
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Not submitted yet: *${pluralize('entry', unsubmitted.count, true)}* (${getDisplayTime(unsubmitted.minutes)})`,
              },
            } as AnyBlock,
          ]
        : []),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '➕ Log Time' },
            style: 'primary',
            action_id: HomeTabActionId.LogTime,
          },
          ...(unsubmitted.count
            ? [
                {
                  type: 'button' as const,
                  text: {
                    type: 'plain_text' as const,
                    text: `📤 Submit for Approval (${unsubmitted.count})`,
                  },
                  action_id: HomeTabActionId.SubmitTimeEntries,
                },
              ]
            : []),
          {
            type: 'button',
            text: { type: 'plain_text', text: '✏️ Edit Entries' },
            action_id: HomeTabActionId.EditTimeEntries,
          },
        ],
      },
      { type: 'divider' },
    ];
  }
}
