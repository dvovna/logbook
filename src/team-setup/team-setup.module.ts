import { Module } from '@nestjs/common';
import { TeamSetupWorkflowService } from '@modules/team-setup/team-setup-workflow.service';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { UsersModule } from '@modules/users/users.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { TeamUsersSyncService } from '@modules/team-setup/team-users-sync.service';
import { TeamsModule } from '@modules/teams/teams.module';
import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';

@Module({
  imports: [
    SlackTeamsModule,
    UsersModule,
    VacationPoliciesModule,
    SlackCommunicationModule,
    TeamsModule,
  ],
  providers: [
    TeamSetupWorkflowService,
    TeamUsersSyncService,
    MemberSyncScheduleService,
  ],
  exports: [TeamSetupWorkflowService],
})
export class TeamSetupModule {}
