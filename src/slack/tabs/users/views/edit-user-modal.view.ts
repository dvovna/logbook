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
import { IOption } from '@modules/slack/common/types/option.interface';

interface IGetViewParams extends IBaseModalViewParams {
  user: IUserViewModel;
  teams: ITeamViewModel[];
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
    teams,
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
        options: ROLE_OPTIONS,
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
      this.addUnusedDaysBlock(user.carryover_days),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private addUnusedDaysBlock(daysUnused: number | null = 0) {
    return {
      type: 'input',
      block_id: 'carryover_days_block',
      element: {
        type: 'number_input',
        action_id: 'carryover_days',
        is_decimal_allowed: false,
        min_value: '0',
        max_value: '30',
        initial_value: daysUnused !== null ? daysUnused.toString() : '0',
      },
      label: {
        type: 'plain_text',
        text: 'Carryover Days',
      },
    };
  }
}
