import { Module } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { UserVacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { TeamsModule } from 'src/teams/teams.module';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { HolidaysModule } from 'src/holidays/holidays.module';
import { VacationRequestProcessingService } from 'src/vacation-requests/services/vacation-request-processing.service';
import { RequestWorkflowsModule } from 'src/request-workflows/request-workflows.module';

@Module({
  imports: [
    VacationPoliciesModule,
    TeamsModule,
    HolidaysModule,
    RequestWorkflowsModule,
  ],
  providers: [
    VacationDaysCalculationService,
    VacationRequestsValidationService,
    VacationRequestsService,
    VacationRequestsRepository,
    UserVacationsUsageService,
    VacationRequestProcessingService,
  ],
  exports: [VacationRequestsService, UserVacationsUsageService],
})
export class VacationRequestsModule {}
