import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TeamFileMessageHandler } from '@modules/slack/team-file/handlers/team-file-message.handler';
import { NewPersonPromptHandler } from '@modules/slack/team-file/handlers/new-person-prompt.handler';
import { NewPersonPromptsService } from '@modules/slack/team-file/services/new-person-prompts.service';
import { NewPersonPromptView } from '@modules/slack/team-file/views/new-person-prompt.view';
import { TeamFileMessagesService } from '@modules/slack/team-file/services/team-file-messages.service';
import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { TeamsTabModule } from '@modules/slack/tabs/teams/teams-tab.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { TeamFileModule } from 'src/team-file/team-file.module';

// Apart from TeamFileSlackModule, which the Teams tab imports: the handler
// opens the Teams tab's form, so it needs TeamsTabModule.
@Module({
  imports: [
    SlackCommonModule,
    TeamFileModule,
    TeamsModule,
    TeamsTabModule,
    UsersModule,
  ],
  providers: [
    NewPersonPromptHandler,
    NewPersonPromptsService,
    NewPersonPromptView,
    TeamFileMessageHandler,
    TeamFileMessagesService,
    TeamFileMessageView,
  ],
  exports: [TeamFileMessagesService],
})
export class TeamFileMessagesModule {}
