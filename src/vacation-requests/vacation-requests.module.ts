import { Module } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { UserVacationsUsageService } from 'src/vacation-requests/services/user-vacation-usage.service';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { TeamsModule } from 'src/teams/teams.module';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { HolidaysModule } from 'src/holidays/holidays.module';

@Module({
  imports: [VacationPoliciesModule, TeamsModule, HolidaysModule],
  providers: [
    VacationDaysCalculationService,
    VacationRequestsValidationService,
    VacationRequestsService,
    VacationRequestsRepository,
    UserVacationsUsageService,
  ],
  exports: [VacationRequestsService, UserVacationsUsageService],
})
export class VacationRequestsModule {}
