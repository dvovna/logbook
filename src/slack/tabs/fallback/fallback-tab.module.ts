import { Module } from '@nestjs/common';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { FallbackTabView } from 'src/slack/tabs/fallback/views/fallback-tab.view';
import { FallbackTabActionHandler } from 'src/slack/tabs/fallback/handlers/fallback-tab-action.handler';

@Module({
  imports: [SlackCommonModule],
  providers: [FallbackTabActionHandler, FallbackTabView],
  exports: [FallbackTabView],
})
export class HolidaysTabModule {}
