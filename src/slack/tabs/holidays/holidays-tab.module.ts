import { Module } from '@nestjs/common';
import { HolidaysModule } from 'src/holidays/holidays.module';
import { HolidaysTabService } from 'src/slack/tabs/holidays/services/holidays-tab.service';
import HolidaysTabActionHandler from 'src/slack/tabs/holidays/handlers/holidays-tab-action.handler';
import { HolidayFormSubmitHandler } from 'src/slack/tabs/holidays/handlers/holiday-form-submit.handler';
import { ToggleHolidayStatusFormSubmitHandler } from 'src/slack/tabs/holidays/handlers/toggle-holiday-status-form-submit.handler';
import { ImportHolidaysFormSubmitHandler } from 'src/slack/tabs/holidays/handlers/import-holidays-form-submit.handler';
import HolidayModalViewValuesParser from 'src/slack/tabs/holidays/parsers/holiday-modal-view-values.parser';
import ImportHolidaysModalViewValuesParser from 'src/slack/tabs/holidays/parsers/import-holidays-modal-view-values.parser';
import { DeleteHolidayHandler } from 'src/slack/tabs/holidays/handlers/delete-holiday.handler';
import { ImportHolidaysModalView } from 'src/slack/tabs/holidays/views/import-holidays-modal.view';
import { HolidaysTabView } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import { HolidayModalView } from 'src/slack/tabs/holidays/views/holiday-modal.view';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';

@Module({
  imports: [HolidaysModule, VacationPoliciesModule, SlackCommonModule],
  providers: [
    HolidaysTabService,
    HolidaysTabActionHandler,
    HolidayFormSubmitHandler,
    ToggleHolidayStatusFormSubmitHandler,
    ImportHolidaysFormSubmitHandler,
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
