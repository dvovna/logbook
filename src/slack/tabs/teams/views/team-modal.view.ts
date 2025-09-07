import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { MAX_DESCRIPTION_LENGTH } from 'src/slack/tabs/teams/parsers/team-modal-view-values.parser';
import BaseModalView from 'src/slack/common/views/base-modal.view';
import { View } from '@slack/types/dist/views';

interface IGetViewParams {
  initialData?: {
    id: string;
    name: string;
    description?: string;
    vacation_policy_id?: string;
  } | null;
  policies: { id: string; name: string }[];
  errorMessage?: string;
}

export type ITeamModalViewMetadata = {
  id: string | null;
};

@Injectable()
export class TeamModalView extends BaseModalView<IGetViewParams> {
  public getView({
    initialData,
    policies,
    errorMessage,
  }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.TeamFormSubmit,
      private_metadata: JSON.stringify({
        id: initialData?.id || null,
      } as ITeamModalViewMetadata),
      title: {
        type: 'plain_text',
        text: initialData ? 'Edit Team' : 'Create Team',
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
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name',
            initial_value: initialData?.name || '',
          },
          label: {
            type: 'plain_text',
            text: 'Team Name',
          },
        },
        this.getPolicyBlock(policies, initialData?.vacation_policy_id),
        {
          type: 'input',
          block_id: 'description_block',
          optional: true,
          element: {
            type: 'plain_text_input',
            multiline: true,
            action_id: 'description',
            max_length: MAX_DESCRIPTION_LENGTH,
            initial_value: initialData?.description || '',
          },
          label: {
            type: 'plain_text',
            text: 'Description',
          },
        },
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
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
        action_id: 'policy',
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
