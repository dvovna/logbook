import { Module } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { TeamsModule } from 'src/teams/teams.module';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { HolidaysModule } from 'src/holidays/holidays.module';
import { VacationRequestProcessingService } from 'src/vacation-requests/services/vacation-request-processing.service';
import { RequestWorkflowsModule } from 'src/request-workflows/request-workflows.module';
import { RequestWorkflowProcessingService } from 'src/vacation-requests/services/request-workflow-processing.service';
import { UsersModule } from 'src/users/users.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';
import { VacationPeriodUsageCacheService } from 'src/vacation-requests/services/vacation-period-usage-cache.service';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    CacheModule.register(),
    VacationPoliciesModule,
    TeamsModule,
    UsersModule,
    HolidaysModule,
    RequestWorkflowsModule,
    SlackCommunicationModule,
  ],
  providers: [
    VacationDaysCalculationService,
    VacationRequestsValidationService,
    VacationRequestsService,
    VacationRequestsRepository,
    VacationsUsageService,
    VacationRequestProcessingService,
    RequestWorkflowProcessingService,
    VacationPeriodUsageService,
    VacationPeriodUsageCacheService,
  ],
  exports: [VacationRequestsService, VacationsUsageService],
})
export class VacationRequestsModule {}
