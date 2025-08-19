import { Module } from '@nestjs/common';
import { VacationsService } from 'src/vacations/vacations.service';
import { VacationsRepository } from 'src/vacations/vacations.repository';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [VacationPoliciesModule, TeamsModule],
  providers: [VacationsService, VacationsRepository, UserVacationsUsageService],
  exports: [VacationsService, UserVacationsUsageService],
})
export class VacationsModule {}
