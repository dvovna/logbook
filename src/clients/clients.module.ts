import { Module } from '@nestjs/common';
import SlackApiClient from 'src/clients/third-party/slack-api.client';

@Module({
  providers: [SlackApiClient],
  exports: [SlackApiClient],
})
export class ClientsModule {}
