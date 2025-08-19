import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ITeamViewModel from 'src/teams/types/team.interface';
import { MAX_DESCRIPTION_LENGTH } from 'src/slack/services/slack-views/parsers/team-modal-view-values.parser';
import BaseViewService from 'src/slack/services/slack-views/base.view-service';
import { View } from '@slack/types/dist/views';

interface IGetViewParams {
  team?: ITeamViewModel | null;
  policies: { id: string; name: string }[];
  generalError?: string;
}

export type IGetTeamModalViewMetadata = {
  teamIdToEdit: string | null;
};

@Injectable()
export class TeamModalViewService extends BaseViewService<IGetViewParams> {
  public getView({ team, policies, generalError }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.TeamManagement,
      private_metadata: JSON.stringify({
        teamIdToEdit: team?.id,
      } as IGetTeamModalViewMetadata),
      title: {
        type: 'plain_text',
        text: team ? 'Edit Team' : 'Create Team',
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
        ...(generalError ? [this.getGeneralErrorBlock(generalError)] : []),
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name',
            initial_value: team?.name || '',
          },
          label: {
            type: 'plain_text',
            text: 'Team Name',
          },
        },
        this.getPolicyBlock(policies, team?.vacation_policy_id),
        {
          type: 'input',
          block_id: 'description_block',
          optional: true,
          element: {
            type: 'plain_text_input',
            multiline: true,
            action_id: 'description',
            max_length: MAX_DESCRIPTION_LENGTH,
            initial_value: team?.description || '',
          },
          label: {
            type: 'plain_text',
            text: 'Description',
          },
        },
      ],
    };
  }

  private getPolicyBlock(
    policies: { id: string; name: string }[],
    teamPolicyId?: string,
  ) {
    const vacationPolicyName = policies.find(
      (policy) => policy.id === teamPolicyId,
    )?.name;

    return {
      type: 'input',
      block_id: 'policy_block',
      element: {
        type: 'static_select',
        action_id: 'policy_id',
        placeholder: {
          type: 'plain_text',
          text: 'Select a vacation policy',
        },
        options: policies.map((policy) => ({
          text: {
            type: 'plain_text',
            text: policy.name,
          },
          value: policy.id,
        })),
        initial_option: vacationPolicyName && {
          text: {
            type: 'plain_text',
            text: vacationPolicyName,
          },
          value: teamPolicyId,
        },
      },
      label: {
        type: 'plain_text',
        text: 'Vacation Policy',
      },
    };
  }
}
