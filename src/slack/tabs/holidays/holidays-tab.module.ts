import { Module } from '@nestjs/common';
import { HolidaysModule } from '@modules/holidays/holidays.module';
import { HolidaysTabService } from '@modules/slack/tabs/holidays/services/holidays-tab.service';
import HolidaysTabActionHandler from '@modules/slack/tabs/holidays/handlers/holidays-tab-action.handler';
import { HolidayFormSubmitHandler } from '@modules/slack/tabs/holidays/handlers/holiday-form-submit.handler';
import { ToggleHolidayStatusFormSubmitHandler } from '@modules/slack/tabs/holidays/handlers/toggle-holiday-status-form-submit.handler';
import { ImportHolidaysFormSubmitHandler } from '@modules/slack/tabs/holidays/handlers/import-holidays-form-submit.handler';
import { ImportHolidaysFormActionHandler } from '@modules/slack/tabs/holidays/handlers/import-holidays-form-action.handler';
import HolidayModalViewValuesParser from '@modules/slack/tabs/holidays/parsers/holiday-modal-view-values.parser';
import ImportHolidaysModalViewValuesParser from '@modules/slack/tabs/holidays/parsers/import-holidays-modal-view-values.parser';
import { DeleteHolidayHandler } from '@modules/slack/tabs/holidays/handlers/delete-holiday.handler';
import { ImportHolidaysModalView } from '@modules/slack/tabs/holidays/views/import-holidays-modal.view';
import { HolidaysTabView } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import { HolidayModalView } from '@modules/slack/tabs/holidays/views/holiday-modal.view';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';

@Module({
  imports: [HolidaysModule, VacationPoliciesModule, SlackCommonModule],
  providers: [
    HolidaysTabService,
    HolidaysTabActionHandler,
    HolidayFormSubmitHandler,
    ToggleHolidayStatusFormSubmitHandler,
    ImportHolidaysFormSubmitHandler,
    ImportHolidaysFormActionHandler,
    DeleteHolidayHandler,
    HolidayModalViewValuesParser,
    ImportHolidaysModalViewValuesParser,
    ImportHolidaysModalView,
    HolidayModalView,
    HolidaysTabView,
  ],
  exports: [HolidaysTabService],
})
export class HolidaysTabModule {}
