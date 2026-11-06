import { Module } from '@nestjs/common';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from '@modules/vacation-requests/repositories/vacation-requests.repository';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsValidationService } from '@modules/vacation-requests/services/vacation-requests-validation.service';
import { HolidaysModule } from '@modules/holidays/holidays.module';
import { VacationRequestProcessingService } from '@modules/vacation-requests/services/vacation-request-processing.service';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { RequestWorkflowProcessingService } from '@modules/vacation-requests/services/request-workflow-processing.service';
import { UsersModule } from '@modules/users/users.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';
import { VacationPeriodUsageCacheService } from '@modules/vacation-requests/services/vacation-period-usage-cache.service';
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
