import { Module } from '@nestjs/common';
import { TeamSetupWorkflowService } from 'src/team-setup/team-setup-workflow.service';
import { TeamsModule } from 'src/teams/teams.module';
import { UsersModule } from 'src/users/users.module';
import { TeamSettingsModule } from 'src/team-settings/team-settings.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TeamUsersSyncService } from 'src/team-setup/team-users-sync.service';

@Module({
  imports: [
    TeamsModule,
    UsersModule,
    TeamSettingsModule,
    SlackCommunicationModule,
  ],
  providers: [TeamSetupWorkflowService, TeamUsersSyncService],
  exports: [TeamSetupWorkflowService],
})
export class TeamSetupModule {}
