import { Module } from '@nestjs/common';
import { VacationsService } from 'src/vacations/vacations.service';
import { VacationsRepository } from 'src/vacations/vacations.repository';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import { TeamSettingsModule } from 'src/team-settings/team-settings.module';

@Module({
  imports: [TeamSettingsModule],
  providers: [VacationsService, VacationsRepository, UserVacationsUsageService],
  exports: [VacationsService, UserVacationsUsageService],
})
export class VacationsModule {}
