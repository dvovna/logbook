import { Module } from '@nestjs/common';
import SlackCommandPromptsService from '@modules/slack-communication/services/slack-command-prompts.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import SlackUsersService from '@modules/slack-communication/services/slack-users.service';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { CacheModule } from '@nestjs/cache-manager';
import { ApiClientsModule } from 'src/api-clients/api-clients.module';

@Module({
  providers: [
    SlackCommandPromptsService,
    AccessTokenService,
    SlackCommunicationService,
    SlackUsersService,
  ],
  imports: [CacheModule.register(), ApiClientsModule, SlackTeamsModule],
  exports: [
    AccessTokenService,
    SlackCommandPromptsService,
    SlackCommunicationService,
    SlackUsersService,
  ],
})
export class SlackCommunicationModule {}
