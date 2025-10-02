import { Module } from '@nestjs/common';
import SlackCommandPromptsService from 'src/slack-communication/services/slack-command-prompts.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ClientsModule } from 'src/clients/clients.module';

@Module({
  providers: [
    SlackCommandPromptsService,
    AccessTokenService,
    SlackCommunicationService,
    SlackUsersService,
  ],
  imports: [CacheModule.register(), ClientsModule, SlackTeamsModule],
  exports: [SlackCommandPromptsService, SlackCommunicationService, SlackUsersService],
})
export class SlackCommunicationModule {}
