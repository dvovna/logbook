import { Module } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { SlackTeamsRepository } from '@modules/slack-teams/slack-teams.repository';
import { TokenCipherService } from '@modules/slack-teams/token-cipher.service';

@Module({
  providers: [SlackTeamsService, SlackTeamsRepository, TokenCipherService],
  exports: [SlackTeamsService, SlackTeamsRepository],
})
export class SlackTeamsModule {}
