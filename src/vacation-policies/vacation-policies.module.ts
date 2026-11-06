import { Module } from '@nestjs/common';
import VacationPoliciesRepository from '@modules/vacation-policies/repositories/vacation-policies.repository';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { HolidaysModule } from '@modules/holidays/holidays.module';
import { TeamsModule } from '@modules/teams/teams.module';

@Module({
  imports: [HolidaysModule, TeamsModule],
  providers: [VacationPoliciesService, VacationPoliciesRepository],
  exports: [VacationPoliciesService],
})
export class VacationPoliciesModule {}
