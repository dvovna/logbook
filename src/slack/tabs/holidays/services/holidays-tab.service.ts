import { Injectable } from '@nestjs/common';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import ConfirmationModalView from 'src/slack/common/views/confirmation-modal.view';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabView,
  IHolidaysTabMetadata,
} from 'src/slack/tabs/holidays/views/holidays-tab.view';
import HolidaysService from 'src/holidays/services/holidays.service';
import { HolidayModalView } from 'src/slack/tabs/holidays/views/holiday-modal.view';
import { ImportHolidaysModalView } from 'src/slack/tabs/holidays/views/import-holidays-modal.view';
import { ConfigService } from '@nestjs/config';
import { jsonParse } from 'src/common/utils/json-parse';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import { getDateOnly } from 'src/common/utils/date.utils';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';

interface IHolidayModalViewParams extends IOpenModalBaseParams<string> {
  holidayId: string;
}

export enum HolidaysTabModalName {
  CreateHoliday = 'CreateHoliday',
  UpdateHoliday = 'UpdateHoliday',
  ImportHolidays = 'ImportHolidays',
  ToggleHolidayStatus = 'ToggleHolidayStatus',
  DeleteHoliday = 'DeleteHoliday',
}

export interface IPublishHolidaysTabPublishParams extends IPublishBaseParams {
  metadata: {
    page?: number;
    filters: {
      policyId: string;
      selectedYear?: number;
    };
  };
}

type HolidaysTabModalViewResolversMapType = {
  [HolidaysTabModalName.CreateHoliday]: (
    params: IOpenModalBaseParams<string>,
  ) => View;
  [HolidaysTabModalName.UpdateHoliday]: (
    params: IHolidayModalViewParams,
  ) => Promise<View>;
  [HolidaysTabModalName.ToggleHolidayStatus]: (
    params: IHolidayModalViewParams,
  ) => Promise<View>;
  [HolidaysTabModalName.ImportHolidays]: (
    params: IOpenModalBaseParams<string>,
  ) => View;
  [HolidaysTabModalName.DeleteHoliday]: (
    params: IHolidayModalViewParams,
  ) => Promise<View>;
};

export const MIN_YEAR = 2025;
export const MAX_YEAR = 2030;

const CURRENT_YEAR = new Date().getFullYear();

@Injectable()
export class HolidaysTabService extends BaseTabService<
  HolidaysTabModalViewResolversMapType,
  IPublishHolidaysTabPublishParams
> {
  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly holidaysTabViewService: HolidaysTabView,
    private readonly holidayModalViewService: HolidayModalView,
    private readonly importHolidaysModalViewService: ImportHolidaysModalView,
    private readonly confirmationModalViewService: ConfirmationModalView,
    private readonly config: ConfigService,
  ) {
    super(TabId.Holidays, {
      [HolidaysTabModalName.CreateHoliday]: (params) =>
        this.createHolidayModalView(params),
      [HolidaysTabModalName.UpdateHoliday]: (params) =>
        this.updateHolidayModalView(params),
      [HolidaysTabModalName.ImportHolidays]: (params) =>
        this.importHolidaysModalView(params),
      [HolidaysTabModalName.ToggleHolidayStatus]: (params) =>
        this.toggleStatusModalView(params),
      [HolidaysTabModalName.DeleteHoliday]: (params) =>
        this.deleteHolidayModalView(params),
    });
  }

  public async getTabView({
    user,
    metadata,
  }: IPublishHolidaysTabPublishParams) {
    const {
      filters: { policyId, selectedYear = CURRENT_YEAR },
    } = metadata;

    const [countryHolidays, companyHolidays, policy] = await Promise.all([
      this.holidaysService.search({
        filters: {
          slackTeamId: user.slack_team_id,
          year: selectedYear,
          vacationPolicyId: policyId,
          isCompanyCustom: false,
        },
        page: metadata.page,
        sortBy: 'date',
        sortOrder: 'asc',
      }),
      this.holidaysService.findMany({
        slackTeamId: user.slack_team_id,
        year: selectedYear,
        vacationPolicyId: policyId,
        isCompanyCustom: true,
      }),
      this.vacationPoliciesService.findOneWithValidation({
        id: policyId,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    const minYear = this.config.getOrThrow<number>(EnvironmentVariable.MinYear);
    const maxYear = this.config.getOrThrow<number>(EnvironmentVariable.MaxYear);

    return this.holidaysTabViewService.getView(
      {
        userId: user.slack_id,
        countryHolidays,
        companyHolidays,
        policyName: policy.name,
        policyId,
        selectedYear: selectedYear,
        years: Array.from(
          { length: maxYear - minYear + 1 },
          (_, index) => index + minYear,
        ),
      },
      {
        ...metadata,
        filters: {
          ...metadata.filters,
          selectedYear,
        },
      },
    );
  }

  private importHolidaysModalView({
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    return this.importHolidaysModalViewService.getView({
      errorMessage,
      pageMetadata,
    });
  }

  private createHolidayModalView({
    errorMessage,
    pageMetadata,
  }: IOpenModalBaseParams<string>) {
    const parsedPageMetadata = jsonParse<IHolidaysTabMetadata>(pageMetadata);

    if (!parsedPageMetadata) {
      throw new Error('Invalid page metadata');
    }

    const initialDate = new Date();
    initialDate.setFullYear(parsedPageMetadata.filters.selectedYear);

    return this.holidayModalViewService.getView({
      errorMessage,
      pageMetadata,
      initialDate: getDateOnly(initialDate),
    });
  }

  private async updateHolidayModalView({
    holidayId,
    user,
    pageMetadata,
    errorMessage,
  }: IHolidayModalViewParams) {
    const holiday = await this.holidaysService.findOneWithValidation({
      slackTeamId: user.slack_team_id,
      id: holidayId,
    });

    return this.holidayModalViewService.getView({
      errorMessage,
      holiday,
      pageMetadata,
    });
  }

  private async toggleStatusModalView({
    holidayId,
    user,
    errorMessage,
    pageMetadata,
  }: IHolidayModalViewParams) {
    const holiday = await this.holidaysService.findOneWithValidation({
      id: holidayId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalViewService.getView({
      callbackId: ViewCallbackId.ToggleHolidayStatus,
      title: `${holiday.is_disabled ? 'Activate' : 'Deactivate'} Holiday`,
      message: `Are you sure you want to ${holiday.is_disabled ? 'activate' : 'deactivate'} the holiday *${holiday.name}*?`,
      entityId: holiday.id,
      errorMessage,
      pageMetadata,
    });
  }

  private async deleteHolidayModalView({
    holidayId,
    user,
    errorMessage,
    pageMetadata,
  }: IHolidayModalViewParams) {
    const holiday = await this.holidaysService.findOneWithValidation({
      id: holidayId,
      slackTeamId: user.slack_team_id,
    });

    return this.confirmationModalViewService.getView({
      callbackId: ViewCallbackId.DeleteHoliday,
      title: 'Delete Holiday',
      message: `Are you sure you want to delete the holiday *${holiday.name}*? This action cannot be undone.`,
      entityId: holiday.id,
      errorMessage,
      pageMetadata,
    });
  }
}
