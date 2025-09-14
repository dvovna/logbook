import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';

interface IGetViewParams extends IBaseTabViewParams {
  policies: IVacationPolicyViewModel[];
}

export enum PolicyTabViewActionId {
  AddPolicy = 'add_policy',
  EditPolicy = 'edit_policy',
  EditHolidays = 'edit_holidays',
  DeletePolicy = 'delete_policy',
  ManagePolicyMenu = 'manage_policy_menu',
}

@Injectable()
export class VacationPolicyTabView extends BaseAdminTabView<
  IGetViewParams,
  never
> {
  protected callbackId = ViewCallbackId.VacationPoliciesTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageVacationPolicies;

  protected getTabTitle() {
    return '*🏢 Vacation Policy Management*';
  }

  protected getTitleAccessory(): SectionBlockAccessory | null {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Policy' },
      action_id: PolicyTabViewActionId.AddPolicy,
    };
  }

  protected getContentBlocks({ policies }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const blocksToAdd = this.getPolicyListBlocks(policies);

    blocks.push(...blocksToAdd);

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
              `Created: ${createdAt}\n` +
              `Updated: ${updatedAt}`,
          },
        ],
        accessory: {
          type: 'overflow',
          action_id: PolicyTabViewActionId.ManagePolicyMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit Policy' },
              value: `${PolicyTabViewActionId.EditPolicy}:${policy.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Edit Holidays' },
              value: `${PolicyTabViewActionId.EditHolidays}:${policy.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Delete Policy' },
              value: `${PolicyTabViewActionId.DeletePolicy}:${policy.id}`,
            },
          ],
        },
      });

      blocks.push({ type: 'divider' });
    }

    return blocks;
  }
}
