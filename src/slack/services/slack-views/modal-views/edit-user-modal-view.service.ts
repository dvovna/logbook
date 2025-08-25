import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import { IUserViewModel } from 'src/users/types/user.interface';
import { PlainTextOption } from '@slack/web-api';
import { ROLE_OPTIONS } from 'src/slack/constants/use-roles.constants';
import ITeamViewModel from 'src/teams/types/team.interface';

interface IGetViewParams {
  user: IUserViewModel;
  teams: ITeamViewModel[];
  errorMessage?: string;
  pageMetadata?: string;
}

export type IEditUserModalViewMetadata = {
  userIdToEdit: string;
  pageMetadata?: string;
};

@Injectable()
export class EditUserModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({
    user,
    teams,
    errorMessage,
    pageMetadata,
  }: IGetViewParams): View {
    const userRole = ROLE_OPTIONS.find(({ value }) => user.role === value)!;
    const teamOptions = teams.map<PlainTextOption>(({ id, name }) => ({
      value: id,
      text: {
        type: 'plain_text',
        text: name,
      },
    }));
    const userTeam = teamOptions.find(({ value }) => user.team_id === value)!;

    return {
      type: 'modal',
      callback_id: ViewCallbackId.EditUserModalView,
      private_metadata: JSON.stringify({
        userIdToEdit: user.id,
        pageMetadata,
      } as IEditUserModalViewMetadata),
      title: {
        type: 'plain_text',
        text: 'Edit User',
      },
      submit: {
        type: 'plain_text',
        text: 'Save',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
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
            initial_option: user.role ? userRole : undefined,
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
      ],
    };
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
        initial_value: daysUnused ? daysUnused.toString() : '0',
      },
      label: {
        type: 'plain_text',
        text: 'Carryover Days',
      },
    };
  }
}
