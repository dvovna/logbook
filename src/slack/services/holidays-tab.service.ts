import { Injectable } from '@nestjs/common';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import ConfirmationModalViewService from 'src/slack/services/slack-views/modal-views/confirmation-modal-view.service';
import BaseTabViewService, {
  IOpenModalBaseParams,
} from 'src/slack/services/base-tab-view.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { HolidaysTabViewService } from 'src/slack/services/slack-views/tab-views/holidays-tab-view.service';
import HolidaysService from 'src/holidays/holidays.service';
import { HolidayModalViewService } from 'src/slack/services/slack-views/modal-views/holiday-modal-view.service';
import { ImportHolidaysModalViewService } from 'src/slack/services/slack-views/modal-views/import-holidays-modal-view.service';
import { ConfigService } from '@nestjs/config';

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

interface IPublishTabParams extends IOpenModalBaseParams {
  policyId: string;
  selectedYear?: number;
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
export class HolidaysTabService extends BaseTabViewService<
  HolidaysTabModalViewResolversMapType,
  IPublishTabParams
> {
  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly holidaysTabViewService: HolidaysTabViewService,
    private readonly holidayModalViewService: HolidayModalViewService,
    private readonly importHolidaysModalViewService: ImportHolidaysModalViewService,
    private readonly confirmationModalViewService: ConfirmationModalViewService,
    private readonly config: ConfigService,
  ) {
    super({
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
    policyId,
    selectedYear = CURRENT_YEAR,
  }: IPublishTabParams) {
    const [holidays, policy] = await Promise.all([
      this.holidaysService.findMany({
        slackTeamId: user.slack_team_id,
        year: selectedYear,
        vacationPolicyId: policyId,
      }),
      this.vacationPoliciesService.findOneWithValidation({
        id: policyId,
        slackTeamId: user.slack_team_id,
      }),
    ]);

    const minYear = this.config.getOrThrow<number>('MIN_YEAR');
    const maxYear = this.config.getOrThrow<number>('MAX_YEAR');

    return this.holidaysTabViewService.getView({
      userId: user.slack_id,
      holidays,
      policyName: policy.name,
      policyId,
      selectedYear: selectedYear,
      years: Array.from(
        { length: maxYear - minYear + 1 },
        (_, index) => index + minYear,
      ),
    });
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
    return this.holidayModalViewService.getView({
      errorMessage,
      pageMetadata,
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
    });
  }

  private async deleteHolidayModalView({
    holidayId,
    user,
    errorMessage,
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
    });
  }
}
