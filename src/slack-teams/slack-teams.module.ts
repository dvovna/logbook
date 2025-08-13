import { Module } from '@nestjs/common';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { SlackTeamsRepository } from 'src/slack-teams/slack-teams.repository';

@Module({
  providers: [SlackTeamsService, SlackTeamsRepository],
  exports: [SlackTeamsService, SlackTeamsRepository],
})
export class SlackTeamsModule {}
