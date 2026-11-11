import { Module } from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { SlackTeamsRepository } from '@modules/slack-teams/slack-teams.repository';
import { TokenCipherService } from '@modules/slack-teams/token-cipher.service';
import { WorkspaceRetentionService } from '@modules/slack-teams/workspace-retention.service';
import { SlackEventReceiptsRepository } from '@modules/slack-teams/slack-event-receipts.repository';
import { SlackEventReceiptsService } from '@modules/slack-teams/slack-event-receipts.service';

@Module({
  providers: [
    SlackTeamsService,
    SlackTeamsRepository,
    TokenCipherService,
    WorkspaceRetentionService,
    SlackEventReceiptsRepository,
    SlackEventReceiptsService,
  ],
  exports: [
    SlackTeamsService,
    SlackTeamsRepository,
    WorkspaceRetentionService,
    SlackEventReceiptsService,
  ],
})
export class SlackTeamsModule {}
