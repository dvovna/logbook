import { Module } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { SlackTeamsRepository } from '@modules/slack-teams/slack-teams.repository';
import { TokenCipherService } from '@modules/slack-teams/token-cipher.service';
import { WorkspaceRetentionService } from '@modules/slack-teams/workspace-retention.service';

@Module({
  providers: [
    SlackTeamsService,
    SlackTeamsRepository,
    TokenCipherService,
    WorkspaceRetentionService,
  ],
  exports: [SlackTeamsService, SlackTeamsRepository, WorkspaceRetentionService],
})
export class SlackTeamsModule {}
