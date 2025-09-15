import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { IUserViewModel } from 'src/users/types/user.interface';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ROLE_OPTIONS } from 'src/slack/tabs/users/views/options/use-role.options';
import ITeamViewModel from 'src/teams/types/team.interface';

interface IGetViewParams extends IBaseModalViewParams {
  user: IUserViewModel;
  teams: ITeamViewModel[];
}

export interface IEditUserModalViewMetadata {
  userIdToEdit: string;
  pageMetadata: string;
}

@Injectable()
export class EditUserModalView extends BaseModalView<
  IGetViewParams,
  IEditUserModalViewMetadata
> {
  protected callbackId = ViewCallbackId.UserFormSubmit;

  protected getTitleText(): string {
    return 'Edit User';
  }

  public getViewBlocks({
    user,
    teams,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const userRole = ROLE_OPTIONS.find(({ value }) => user.role === value);
    const teamOptions = teams.map<PlainTextOption>(({ id, name }) => ({
      value: id,
      text: {
        type: 'plain_text',
        text: name,
      },
    }));
    const userTeam = teamOptions.find(({ value }) => user.team_id === value)!;

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
        block_id: 'role_block',
        label: { type: 'plain_text', text: 'Role' },
        element: {
          type: 'static_select',
          action_id: 'role',
          options: ROLE_OPTIONS,
          initial_option: userRole,
        },
      },
      {
        type: 'input',
        block_id: 'team_block',
        label: { type: 'plain_text', text: 'Team' },
        element: {
          type: 'static_select',
          action_id: 'team_id',
          options: teamOptions,
          initial_option: user.team_id ? userTeam : undefined,
        },
      },
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
