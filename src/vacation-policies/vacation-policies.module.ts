import { Module } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { VacationPoliciesCacheService } from 'src/vacation-policies/services/vacation-policies-cache.service';
import { CacheModule } from '@nestjs/cache-manager';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [CacheModule.register(), TeamsModule],
  providers: [
    VacationPoliciesService,
    VacationPoliciesRepository,
    VacationPoliciesCacheService,
  ],
  exports: [VacationPoliciesService, VacationPoliciesCacheService],
})
export class VacationPoliciesModule {}
