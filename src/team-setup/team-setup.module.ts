import { Module } from '@nestjs/common';
import { TeamSetupWorkflowService } from 'src/team-setup/team-setup-workflow.service';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { UsersModule } from 'src/users/users.module';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { TeamUsersSyncService } from 'src/team-setup/team-users-sync.service';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [
    SlackTeamsModule,
    UsersModule,
    VacationPoliciesModule,
    SlackCommunicationModule,
    TeamsModule,
  ],
  providers: [TeamSetupWorkflowService, TeamUsersSyncService],
  exports: [TeamSetupWorkflowService],
})
export class TeamSetupModule {}
