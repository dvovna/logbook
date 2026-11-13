import { canChangeUser } from '@modules/users/utils/admin-role.utils';
import UserRole from '@common/enums/user-role.enum';
import { MAX_POLICY_DAYS } from '@modules/vacation-policies/constants/policy-limits';
import {
  getCurrentVacationPeriod,
  getJoinedVacationPeriod,
} from '@modules/vacation-requests/utils/vacation-period.utils';
import pluralize from 'pluralize';
import { DAY_MS, getDateOnly, formatDate } from '@common/utils/date.utils';
import { fileBalanceLeft } from '@modules/slack/common/views/data/leave-balance.text';
import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { AnyBlock } from '@slack/web-api';
import { ROLE_OPTIONS } from '@modules/slack/tabs/users/views/options/use-role.options';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import { IOption } from '@common/types/option.interface';

interface IGetViewParams extends IBaseModalViewParams {
  user: IUserViewModel;
  // Of the person who edits: HR is offered only the roles it may give.
  editorRole: UserRole;
  teams: ITeamViewModel[];
  fileBalance: ILeaveBalance | null;
}

export interface IEditUserModalViewMetadata {
  userIdToEdit: string;
  pageMetadata: string;
}

export const NO_TEAM_VALUE = 'NO_TEAM';

const NO_TEAM_OPTION: IOption = {
  name: 'No Team',
  id: NO_TEAM_VALUE,
};

@Injectable()
export class EditUserModalView extends BaseModalView<
  IGetViewParams,
  IEditUserModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.UserFormSubmit;

  protected getTitleText(): string {
    return 'Edit User';
  }

  public getViewBlocks({
    user,
    editorRole,
    teams,
    fileBalance,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const teamOptions = [
      NO_TEAM_OPTION,
      ...teams.map<IOption>(({ id, name }) => ({
        id,
        name,
      })),
    ];
    const selectedTeamId = user.team_id || NO_TEAM_VALUE;

    return [
      {
        type: 'section',
        block_id: 'user_name_block',
        text: {
          type: 'mrkdwn',
          text: `*Name:* ${user.name}`,
        },
      },
      {
        type: 'section',
        block_id: 'user_email_block',
        text: {
          type: 'mrkdwn',
          text: `*Email:* ${user.email}`,
        },
      },
      {
        type: 'input',
        block_id: 'contract_start_date_block',
        label: { type: 'plain_text', text: 'Contract Start Date' },
        optional: true,
        element: {
          type: 'datepicker',
          action_id: 'contract_start_date',
          placeholder: { type: 'plain_text', text: 'Select a date' },
          initial_date: user.contract_start_date || undefined,
        },
      },
      ...SlackStaticSelectView.getView({
        blockId: 'role_block',
        actionId: 'role',
        label: 'Role',
        placeholder: 'Select role',
        options: ROLE_OPTIONS.filter(({ id }) =>
          canChangeUser(editorRole, user.role, { role: id as UserRole }),
        ),
        initialValue: user.role,
      }),
      ...SlackStaticSelectView.getView({
        blockId: 'team_block',
        actionId: 'team_id',
        label: 'Team',
        placeholder: 'Select team',
        options: teamOptions,
        initialValue: selectedTeamId,
      }),
      this.addUnusedDaysBlock(
        user.carryover_days,
        getJoinedVacationPeriod(user.contract_start_date, user.created_at)
          .periodStart,
        this.yearStarts(user.contract_start_date),
        fileBalance,
      ),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  // Entered for the year the person joined in: later years carry over what
  // is left on their own.
  private addUnusedDaysBlock(
    daysUnused: number | null = 0,
    joinedYearStart: Date,
    yearStarts: { current: Date; before: Date },
    fileBalance: ILeaveBalance | null,
  ) {
    return {
      type: 'input',
      block_id: 'carryover_days_block',
      hint: {
        type: 'plain_text',
        text:
          this.fileBalanceHint(fileBalance, joinedYearStart, yearStarts) ??
          `Days left from before they joined, for the vacation year from ${formatDate(joinedYearStart)}. Each later year carries over what is left on its own, up to the policy's limit.`,
      },
      element: {
        type: 'number_input',
        action_id: 'carryover_days',
        is_decimal_allowed: false,
        min_value: '0',
        max_value: String(MAX_POLICY_DAYS),
        initial_value: daysUnused !== null ? daysUnused.toString() : '0',
      },
      label: {
        type: 'plain_text',
        text: 'Carryover Days',
      },
    };
  }

  // Where the current vacation year and the one before it start.
  private yearStarts(contractStartDate: string | null | undefined) {
    const current = getCurrentVacationPeriod(contractStartDate).periodStart;

    return {
      current,
      before: getCurrentVacationPeriod(
        contractStartDate,
        new Date(current.getTime() - DAY_MS),
      ).periodStart,
    };
  }

  // What a balance from a file does to the carryover, or null when it does
  // nothing to it.
  private fileBalanceHint(
    fileBalance: ILeaveBalance | null,
    joinedYearStart: Date,
    { current, before }: { current: Date; before: Date },
  ) {
    if (!fileBalance) {
      return null;
    }

    // In the year before this one it carries over into this one, which then
    // starts from it and not from the profile's carryover.
    if (
      fileBalance.balance_on < getDateOnly(current) &&
      fileBalance.balance_on >= getDateOnly(before)
    ) {
      return `The balance from a file (${fileBalanceLeft(fileBalance)}) falls in the vacation year before this one, so this year starts with what it carries over.`;
    }

    // The file's days left replace the carryover in the year they are in; a
    // unit the file left empty still counts it.
    return fileBalance.days_left !== null &&
      fileBalance.balance_on >= getDateOnly(joinedYearStart)
      ? `This year's balance comes from a file (${pluralize('day', fileBalance.days_left, true)} left on ${formatDate(fileBalance.balance_on)}), so carryover here changes nothing.`
      : null;
  }
}
