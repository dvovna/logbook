import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { BaseAdminTabView } from 'src/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { IBaseTabViewParams } from 'src/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from 'src/slack/common/services/slack-action-permissions.service';
import { ISearchResult } from 'src/common/types/pagination.types';
import { PaginatedListView } from 'src/slack/common/views/components/paginated-list.view';
import { SeparatorComponent } from 'src/slack/common/views/components/separator';

interface IGetViewParams extends IBaseTabViewParams {
  policies: ISearchResult<IVacationPolicyViewModel>;
}

export interface IVacationPoliciesTabMetaData {
  page?: number;
}

export enum PolicyTabViewActionId {
  AddPolicy = 'add_policy',
  EditPolicy = 'edit_policy',
  EditHolidays = 'edit_holidays',
  DeletePolicy = 'delete_policy',
  ManagePolicyMenu = 'manage_policy_menu',
  PaginationPrev = 'policies_pagination_prev',
  PaginationNext = 'policies_pagination_next',
}

@Injectable()
export class VacationPolicyTabView extends BaseAdminTabView<
  IGetViewParams,
  IVacationPoliciesTabMetaData
> {
  protected callbackId = ViewCallbackId.VacationPoliciesTabView;
  protected activeTabActionId = AdminNavigationActionId.ManageVacationPolicies;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '*🏢 Vacation Policy Management*\n\nRules for vacation accrual, periods, and entitlements.';
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

    const listBlocks = PaginatedListView.getBlocks<IVacationPolicyViewModel>({
      itemsData: policies,
      getItemBlocks: (item: IVacationPolicyViewModel) =>
        this.getPolicyListItemBlocks(item),
      prevPageActionId: PolicyTabViewActionId.PaginationPrev,
      nextPageActionId: PolicyTabViewActionId.PaginationNext,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getPolicyListItemBlocks(
    policy: IVacationPolicyViewModel,
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const updatedAt = new Date(policy.updated_at).toLocaleDateString();
    const createdAt = new Date(policy.created_at).toLocaleDateString();

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${policy.name}*\n` +
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

    blocks.push(...SeparatorComponent.getBlocks());

    return blocks;
  }
}
