import { Injectable } from '@nestjs/common';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import IHolidayViewModel from 'src/holidays/types/holiday.interface';

interface IGetHolidaysViewParams {
  holidays: IHolidayViewModel[];
  policyName: string;
  policyId: string;
  userId: string;
  selectedYear: number;
  years: number[];
}

export interface IHolidaysTabMetadata {
  policyId: string;
  selectedYear: number;
  years: number[];
}

export enum HolidaysTabViewActionId {
  AddHoliday = 'add_holiday',
  EditHoliday = 'edit_holiday',
  ChangeYear = 'change_year',
  DeleteHoliday = 'delete_holiday',
  ToggleHolidayStatus = 'toggle_holiday_status',
  UploadHolidaysFromCountry = 'upload_holidays_from_country',
  BackToPolicies = 'back_to_policies',
  ManageHolidayMenu = 'manage_holiday_menu',
}

@Injectable()
export class HolidaysTabViewService {
  public getView({
    holidays,
    policyName,
    policyId,
    userId,
    years,
    selectedYear,
  }: IGetHolidaysViewParams) {
    return {
      user_id: userId,
      view: {
        type: 'home',
        private_metadata: JSON.stringify({
          policyId,
          selectedYear,
          years,
        } as IHolidaysTabMetadata),
        callback_id: ViewCallbackId.HolidaysTabView,
        blocks: this.getViewBlocks(
          holidays,
          policyName,
          policyId,
          selectedYear,
          years,
        ),
      },
    } as ViewsPublishArguments;
  }

  private getViewBlocks(
    holidays: IHolidayViewModel[],
    policyName: string,
    policyId: string,
    selectedYear: number,
    years: number[],
  ): AnyBlock[] {
    const blocks: AnyBlock[] = [];

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Holidays for Vacation Policy '${policyName}'*`,
      },
      accessory: {
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
    });

    const countryHolidays = holidays.filter(
      (holiday) => !holiday.is_company_custom,
    );

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🌍 Country Holidays*',
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Upload From Country' },
        action_id: HolidaysTabViewActionId.UploadHolidaysFromCountry,
        value: policyId,
      },
    });

    if (countryHolidays.length === 0) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '_No country holidays. Upload from country._',
        },
      });
    } else {
      for (const holiday of countryHolidays) {
        blocks.push(this.getHolidayBlock(holiday, false));
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ' ',
          },
        });
        blocks.push({ type: 'divider' });
      }
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ' ',
      },
    });

    const custom = holidays.filter((h) => h.is_company_custom);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*🎉 Custom Holidays*',
      },
    });

    if (custom.length === 0) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '_No custom holidays yet._' },
      });
    } else {
      for (const holiday of custom) {
        blocks.push(this.getHolidayBlock(holiday, true));
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ' ',
          },
        });
        blocks.push({ type: 'divider' });
      }
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ' ',
      },
    });

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '➕ Add Holiday' },
          action_id: HolidaysTabViewActionId.AddHoliday,
          value: policyId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Back to Policies' },
          action_id: HolidaysTabViewActionId.BackToPolicies,
        },
      ],
    });

    return blocks;
  }

  private getHolidayBlock(
    holiday: IHolidayViewModel,
    isCustom: boolean,
  ): AnyBlock {
    return {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*${holiday.name}*` },
        { type: 'mrkdwn', text: `Date: ${holiday.date}` },
        {
          type: 'mrkdwn',
          text: `Status: ${holiday.is_disabled ? '🔴' : '🟢'}`,
        },
      ],
      accessory: {
        type: 'overflow',
        action_id: HolidaysTabViewActionId.ManageHolidayMenu,
        options: [
          {
            text: {
              type: 'plain_text',
              text: holiday.is_disabled ? 'Activate' : 'Deactivate',
            },
            value: `${HolidaysTabViewActionId.ToggleHolidayStatus}:${holiday.id}`,
          },
          ...((isCustom
            ? [
              {
                text: { type: 'plain_text', text: 'Edit Holiday' },
                value: `${HolidaysTabViewActionId.EditHoliday}:${holiday.id}`,
              },
              {
                text: { type: 'plain_text', text: 'Delete Holiday' },
                value: `${HolidaysTabViewActionId.DeleteHoliday}:${holiday.id}`,
              },
            ]
            : []) as PlainTextOption[]),
        ],
      },
    };
  }
}
