import { formatDate } from '@common/utils/date.utils';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import IHolidayViewModel from '@modules/holidays/types/holiday.interface';
import { ISearchResult } from '@common/types/pagination.types';
import { COUNTRY_OPTIONS } from '@modules/slack/tabs/holidays/views/options/country.options';
import { PaginatedListView } from '@modules/slack/common/views/components/paginated-list.view';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';

interface IGetHolidaysViewParams extends IBaseTabViewParams {
  countryHolidays: ISearchResult<IHolidayViewModel>;
  companyHolidays: IHolidayViewModel[];
  policyName: string;
  policyId: string;
  selectedYear: number;
  years: number[];
}

export interface IHolidaysTabMetadata {
  page?: number;
  filters: {
    policyId: string;
    selectedYear: number;
  };
}

export enum HolidaysTabViewActionId {
  AddHoliday = 'add_holiday',
  EditHoliday = 'edit_holiday',
  ChangeYear = 'change_year',
  DeleteHoliday = 'delete_holiday',
  ToggleHolidayStatus = 'toggle_holiday_status',
  UploadHolidaysFromCountry = 'upload_holidays_from_country',
  CountryHolidaysPaginationPrev = 'country_holidays_pagination_prev',
  CountryHolidaysPaginationNext = 'country_holidays_pagination_next',
  ManageHolidayMenu = 'manage_holiday_menu',
}

@Injectable()
export class HolidaysTabView extends BaseTabView<
  IGetHolidaysViewParams,
  IHolidaysTabMetadata
> {
  protected callbackId = ViewCallbackId.HolidaysTabView;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected getContentBlocks({
    countryHolidays,
    companyHolidays,
    policyId,
    selectedYear,
    years,
  }: IGetHolidaysViewParams): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push(...this.getFilterBlocks(selectedYear, years));

    blocks.push(...this.getCountryHolidaysBlocks(countryHolidays, policyId));

    blocks.push(...this.getSectionDividerBlocks());

    blocks.push(...this.getCustomHolidaysBlocks(companyHolidays, policyId));

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ' ',
      },
    });

    return blocks;
  }

  private getSectionDividerBlocks() {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ' ',
      },
    });
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ' ',
      },
    });

    return blocks;
  }

  private getCustomHolidaysBlocks(
    companyHolidays: IHolidayViewModel[],
    policyId: string,
  ) {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🎉 Custom Holidays*',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '➕ Add Holiday' },
        action_id: HolidaysTabViewActionId.AddHoliday,
        value: policyId,
      },
    });

    if (companyHolidays.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No custom holidays yet._' },
      });
    } else {
      for (const holiday of companyHolidays) {
        blocks.push(...this.getHolidayBlocks(holiday, true));
      }
    }

    return blocks;
  }

  protected getTabTitle({ policyName }: IGetHolidaysViewParams) {
    return `*🎉 Holidays · ${escapeMrkdwn(policyName)}*\nPublic holidays and company days off: the enabled ones are not working days for the teams on this policy.`;
  }

  private getFilterBlocks(selectedYear: number, years: number[]) {
    return [
      {
        type: 'actions',
        elements: [
          {
            type: 'static_select',
            action_id: HolidaysTabViewActionId.ChangeYear,
            placeholder: { type: 'plain_text', text: 'Select Year' },
            initial_option: {
              text: { type: 'plain_text', text: selectedYear.toString() },
              value: selectedYear.toString(),
            },
            options: years.map((year) => ({
              text: { type: 'plain_text', text: year.toString() },
              value: year.toString(),
            })),
          },
        ],
      },
    ];
  }

  private getCountryHolidaysBlocks(
    countryHolidaysData: ISearchResult<IHolidayViewModel>,
    policyId: string,
  ) {
    const blocks: AnyBlock[] = [];
    const countryCode = countryHolidaysData.items[0]?.country_code || 'N/A';
    const countryOption = COUNTRY_OPTIONS.find(
      ({ value }) => value === countryCode,
    );

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${countryOption?.text.text || '🌍 Country'} Holidays*`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Upload From Country' },
        action_id: HolidaysTabViewActionId.UploadHolidaysFromCountry,
        value: policyId,
      },
    });

    const listBlocks = PaginatedListView.getBlocks<IHolidayViewModel>({
      itemsData: countryHolidaysData,
      getItemBlocks: (item) => this.getHolidayBlocks(item, false),
      prevPageActionId: HolidaysTabViewActionId.CountryHolidaysPaginationPrev,
      nextPageActionId: HolidaysTabViewActionId.CountryHolidaysPaginationNext,
      emptyText: '_No country holidays. Upload from country._',
    });

    blocks.push(...listBlocks);

    return blocks;
  }

  private getHolidayBlocks(
    holiday: IHolidayViewModel,
    isCustom: boolean,
  ): AnyBlock[] {
    return ListItem.getBlocks({
      title: holiday.name,
      details: [
        `Date: ${formatDate(holiday.date)} · Status: ${holiday.is_disabled ? '🔴 Off' : '🟢 On'}`,
      ],
      accessory: {
        type: 'overflow',
        action_id: HolidaysTabViewActionId.ManageHolidayMenu,
        options: [
          ...((isCustom
            ? [
                {
                  text: { type: 'plain_text', text: 'Edit Holiday' },
                  value: `${HolidaysTabViewActionId.EditHoliday}:${holiday.id}`,
                },
              ]
            : []) as PlainTextOption[]),
          {
            text: {
              type: 'plain_text',
              text: holiday.is_disabled
                ? 'Activate Holiday'
                : 'Deactivate Holiday',
            },
            value: `${HolidaysTabViewActionId.ToggleHolidayStatus}:${holiday.id}`,
          },
          ...((isCustom
            ? [
                {
                  text: { type: 'plain_text', text: 'Delete Holiday' },
                  value: `${HolidaysTabViewActionId.DeleteHoliday}:${holiday.id}`,
                },
              ]
            : []) as PlainTextOption[]),
        ],
      },
    });
  }
}
