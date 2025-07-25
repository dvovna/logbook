import { Module } from '@nestjs/common';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import { TeamsModule } from 'src/teams/teams.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ClientsModule } from 'src/clients/clients.module';

@Module({
  providers: [
    SlackPromptsService,
    AccessTokenService,
    SlackCommunicationService,
    SlackUsersService,
  ],
  imports: [CacheModule.register(), ClientsModule, TeamsModule],
  exports: [SlackPromptsService, SlackCommunicationService, SlackUsersService],
})
export class SlackCommunicationModule {}
