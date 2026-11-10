import { Module } from '@nestjs/common';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';

@Module({
  providers: [SlackApiClient],
  exports: [SlackApiClient],
})
export class ApiClientsModule {}
