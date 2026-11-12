import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { LeaveFileUploadsRepository } from 'src/leave-file/repositories/leave-file-uploads.repository';
import { LeaveFileStateService } from 'src/leave-file/services/leave-file-state.service';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';

@Module({
  imports: [
    UsersModule,
    TeamsModule,
    VacationRequestsModule,
    VacationPoliciesModule,
  ],
  providers: [
    LeaveFileUploadsRepository,
    LeaveFileStateService,
    LeaveFileUploadsService,
  ],
  exports: [LeaveFileUploadsService],
})
export class LeaveFileModule {}
