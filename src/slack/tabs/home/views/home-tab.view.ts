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
  // Whether the workspace has any project: without one nobody can log time.
  tracksTime: boolean;
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
    tracksTime,
    pendingApprovals,
    setup,
    receipts,
  }: IGetViewParams) {
    const hasTime =
      tracksTime ||
      timeSummary.weekMinutes > 0 ||
      timeSummary.unsubmitted.count > 0;
    // Each part only when it has something to say, with a divider between.
    const parts = [
      setup ? this.getSetupBlocks(setup) : [],
      this.getAttentionBlocks(pendingApprovals),
      hasTime ? this.getTimeTrackingBlocks(timeSummary) : [],
      receipts ? this.getReceiptsBlocks(receipts) : [],
      // Last: the button under the parts requests time off.
      this.getVacationUsageBlocks(vacationUsageInfo, fileBalance),
      this.getRequestedVacationsBlocks(requestedVacations),
    ].filter((blocks) => blocks.length);

    return [
      ...parts.flatMap((blocks, index) =>
        index ? [...Divider.getBlocks(), ...blocks] : blocks,
      ),
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🌴 Request time off' },
            action_id: HomeTabActionId.OpenVacationModal,
          },
        ],
      } as AnyBlock,
    ];
  }

  // The navigation row already says this is Home.
  protected getTitleBlocks(): AnyBlock[] {
    return [];
  }

  protected getTabTitle() {
    return `*${SCREENS[ScreenId.Home].title}*`;
  }

  // What is left to set up: how many required steps are done, the done
  // ones in one line, the next step with why it matters and its buttons,
  // the required ones after it as a line with a button each, and the
  // optional ones in one row.
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
    const [next, ...later] = required.filter((step) => !step.done);
    const optional = steps.filter((step) => step.optional && !step.done);
    const toButton = ({
      text,
      actionId,
    }: {
      text: string;
      actionId: string;
    }) => ({
      type: 'button' as const,
      text: { type: 'plain_text' as const, text },
      action_id: actionId,
    });

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
      ...(next
        ? [
            {
              type: 'section' as const,
              block_id: `${SETUP_BLOCK_ID}_${next.key}`,
              text: {
                type: 'mrkdwn' as const,
                text: `*Next: ${next.title}*\n${next.why}`,
              },
              // A section holds one button; with more they go in a row below.
              ...(next.buttons.length === 1
                ? { accessory: toButton(next.buttons[0]) }
                : {}),
            },
            ...(next.buttons.length > 1
              ? [
                  {
                    type: 'actions' as const,
                    block_id: `${SETUP_BLOCK_ID}_${next.key}_buttons`,
                    elements: next.buttons.map(toButton),
                  },
                ]
              : []),
          ]
        : []),
      ...later.map(({ key, title, buttons }): AnyBlock => ({
        type: 'section',
        block_id: `${SETUP_BLOCK_ID}_${key}`,
        text: { type: 'mrkdwn', text: `Then: ${title}` },
        accessory: toButton(buttons[0]),
      })),
      ...(optional.length
        ? [
            {
              type: 'context' as const,
              block_id: `${SETUP_BLOCK_ID}_optional`,
              elements: [
                {
                  type: 'mrkdwn' as const,
                  text: `Optional: ${optional.map(({ title }) => title.toLowerCase()).join(' · ')}`,
                },
              ],
            },
            {
              type: 'actions' as const,
              block_id: `${SETUP_BLOCK_ID}_optional_buttons`,
              elements: optional.map(({ buttons }) => toButton(buttons[0])),
            },
          ]
        : []),
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
    // No policy and nothing taken: one line, not a section of empty numbers.
    if (
      vacationsUsageInfo &&
      !vacationsUsageInfo.limits &&
      Object.values(vacationsUsageInfo.usage).every(({ used }) => !used)
    ) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '*🏝 Time off*\nNo vacation policy applies to you yet: you can request time off, and it is tracked without a balance.',
          },
        },
      ];
    }

    const blocks: AnyBlock[] = [
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
      ...(weekMinutes
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: todayMinutes
                  ? `Today: *${getDisplayTime(todayMinutes)}* (${clients})`
                  : 'Today: nothing logged yet',
              },
            } as AnyBlock,
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `This week: *${getDisplayTime(weekMinutes)}* total`,
              },
            } as AnyBlock,
          ]
        : [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'Nothing logged this week yet.' },
            } as AnyBlock,
          ]),
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
    ];
  }
}
