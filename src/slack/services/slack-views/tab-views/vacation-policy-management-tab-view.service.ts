import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';

interface IGetViewParams {
  policies: IVacationPolicyViewModel[];
  userId: string;
}

@Injectable()
export class VacationPolicyManagementTabViewService {
  public getView({ userId, policies }: IGetViewParams) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        callback_id: ViewCallbackId.VacationPolicyManagement,
        blocks: this.getViewBlocks(policies),
      },
    } as ViewsPublishArguments;
  }

  private getViewBlocks(policies: IVacationPolicyViewModel[]): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '*🏢 Vacation Policy Management*' },
    });

    const blocksToAdd = this.getPolicyListBlocks(policies);

    blocks.push(...blocksToAdd);

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '➕ Add Policy' },
          action_id: ViewActionId.AddPolicy,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Back To Home Page' },
          action_id: ViewActionId.BackToHomeTap,
        },
      ],
    });

    return blocks;
  }

  private getPolicyListBlocks(
    policies: IVacationPolicyViewModel[],
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    for (const policy of policies) {
      const isPrimary = policy.is_primary ? '⭐️' : '';
      const updatedAt = new Date(policy.updated_at).toLocaleDateString();
      const createdAt = new Date(policy.created_at).toLocaleDateString();

      blocks.push({
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text:
              `*${policy.name}*${isPrimary}\n` +
              `Vacation Days: ${policy?.vacation_days || '-'}\n` +
              `Working Days: ${policy?.working_days || '-'}\n` +
              `Bonus Days: ${policy?.bonus_days || '-'}\n` +
              `Country: ${policy?.country_code || '-'}\n` +
              `Created: ${createdAt}\n` +
              `Updated: ${updatedAt}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: ViewActionId.ManagePolicyMenu,
          options: [
            {
              text: { type: 'plain_text', text: '✏️ Edit Policy' },
              value: `edit_policy:${policy.id}`,
            },
            {
              text: { type: 'plain_text', text: '👥 Edit Holidays' },
              value: `edit_holidays:${policy.id}`,
            },
          ],
        },
      });

      blocks.push({ type: 'divider' });
    }

    return blocks;
  }
}
