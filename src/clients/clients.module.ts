import { Module } from '@nestjs/common';
import SlackApiClient from '@modules/clients/third-party/slack-api.client';

@Module({
  providers: [SlackApiClient],
  exports: [SlackApiClient],
})
export class ClientsModule {}
