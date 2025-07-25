import { Module } from '@nestjs/common';
import TeamSettingsRepository from 'src/team-settings/team-settings.repository';
import TeamSettingsService from 'src/team-settings/team-settings.service';

@Module({
  providers: [TeamSettingsService, TeamSettingsRepository],
  exports: [TeamSettingsService],
})
export class TeamSettingsModule {}
