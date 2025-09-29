import { Module } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { HolidaysModule } from 'src/holidays/holidays.module';

@Module({
  imports: [HolidaysModule],
  providers: [VacationPoliciesService, VacationPoliciesRepository],
  exports: [VacationPoliciesService],
})
export class VacationPoliciesModule {}
