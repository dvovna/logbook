import { Module } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [TeamsModule],
  providers: [VacationPoliciesService, VacationPoliciesRepository],
  exports: [VacationPoliciesService],
})
export class VacationPoliciesModule {}
