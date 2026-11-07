import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { BaseAdminTabView } from '@modules/slack/common/views/base-admin-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { IBaseTabViewParams } from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { Divider } from '@modules/slack/common/views/components/separator';
import { ISearchResult } from '@common/types/pagination.types';
import { BackButton } from '@modules/slack/common/views/components/back-button';

// "Ada, Bob, Carl and 2 more", for the cards of a list.
const listNames = (names: string[], shown = 5) => {
  const listed = names.slice(0, shown).map(escapeMrkdwn).join(', ');

  return names.length > shown
    ? `${listed} and ${names.length - shown} more`
    : listed;
};

interface IGetViewParams extends IBaseTabViewParams {
  policies: ISearchResult<IVacationPolicyViewModel>;
  // The names of the teams that follow each policy.
  teamsByPolicy: Record<string, string[]>;
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
  protected activeTabActionId = AdminNavigationActionId.ManageVacations;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super(slackActionPermissionsService);
  }

  protected getTabTitle() {
    return '*🏢 Vacation Policy Management*\n\nRules for vacation accrual, periods, and entitlements.';
  }

  protected getBackButtonBlocks(): AnyBlock[] {
    return BackButton.getBlocks(AdminNavigationActionId.ManageVacations);
  }

  protected getTitleAccessory(): SectionBlockAccessory | null {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add Policy' },
      action_id: PolicyTabViewActionId.AddPolicy,
    };
  }

  protected getContentBlocks({ policies, teamsByPolicy }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const listBlocks = PaginatedListView.getBlocks<IVacationPolicyViewModel>({
      itemsData: policies,
      getItemBlocks: (item: IVacationPolicyViewModel) =>
        this.getPolicyListItemBlocks(item, teamsByPolicy[item.id] ?? []),
      prevPageActionId: PolicyTabViewActionId.PaginationPrev,
      nextPageActionId: PolicyTabViewActionId.PaginationNext,
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getPolicyListItemBlocks(
    policy: IVacationPolicyViewModel,
    teams: string[],
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const updatedAt = formatDate(policy.updated_at);
    const createdAt = formatDate(policy.created_at);

    blocks.push({
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text:
            `*${escapeMrkdwn(policy.name)}*\n` +
            // Annual leave is checked against both limits.
            `Annual leave a year: ${policy.vacation_days || 0} calendar days, at most ${policy.working_days || 0} of them working days\n` +
            `Bonus days a year: ${policy.bonus_days || 0}\n` +
            `Carryover: ${policy.carryover_days ? `up to ${policy.carryover_days} days from the previous year` : 'none'}\n` +
            `Used by: ${teams.length ? listNames(teams) : 'no team yet'}\n` +
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

    blocks.push(...Divider.getBlocks());

    return blocks;
  }
}
