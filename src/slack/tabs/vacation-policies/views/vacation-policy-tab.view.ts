import {
  ListItem,
  detail,
} from '@modules/slack/common/views/components/list-item.view';
import { listNames } from '@modules/slack/common/utils/list.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { formatDate } from '@common/utils/date.utils';
import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import { Divider } from '@modules/slack/common/views/components/separator';
import { ISearchResult } from '@common/types/pagination.types';

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
export class VacationPolicyTabView extends BaseTabView<
  IGetViewParams,
  IVacationPoliciesTabMetaData
> {
  protected callbackId = ViewCallbackId.VacationPoliciesTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
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

  protected getContentBlocks({ policies, teamsByPolicy }): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    const listBlocks = PaginatedListView.getBlocks<IVacationPolicyViewModel>({
      itemsData: policies,
      getItemBlocks: (item: IVacationPolicyViewModel) =>
        this.getPolicyListItemBlocks(item, teamsByPolicy[item.id] ?? []),
      prevPageActionId: PolicyTabViewActionId.PaginationPrev,
      nextPageActionId: PolicyTabViewActionId.PaginationNext,
      emptyText:
        '_No vacation policies yet._ Without one, time off is tracked with no limits.',
      emptyAction: {
        text: 'Create a policy',
        actionId: PolicyTabViewActionId.AddPolicy,
      },
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getPolicyListItemBlocks(
    policy: IVacationPolicyViewModel,
    teams: string[],
  ): AnyBlock[] {
    return ListItem.getBlocks({
      title: policy.name,
      details: [
        // Annual leave is checked against both limits.
        detail(
          'Annual leave a year',
          `${policy.vacation_days || 0} calendar days, at most ${policy.working_days || 0} of them working days`,
        ),
        detail('Bonus days a year', policy.bonus_days || 0),
        detail(
          'Carryover',
          policy.carryover_days
            ? `up to ${policy.carryover_days} days from the previous year`
            : 'none',
        ),
        detail('Used by', teams.length ? listNames(teams) : 'no team yet'),
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
  }
}
