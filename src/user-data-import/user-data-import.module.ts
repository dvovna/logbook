import { UsersModule } from '../users/users.module';
import { Module } from '@nestjs/common';
import UserVacationsCsvParser from 'src/user-data-import/parsers/user-vacations-csv.parser';
import { UserVacationsImportService } from 'src/user-data-import/services/user-vacations-import.service';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import UserTeamMappingCsvParser from 'src/user-data-import/parsers/user-team-mapping-csv.parser';
import { UserTeamMappingImportService } from 'src/user-data-import/services/user-team-mapping-import.service';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [
    UsersModule,
    TeamsModule,
    VacationRequestsModule,
    SlackCommunicationModule,
  ],
  providers: [
    UserVacationsImportService,
    UserVacationsCsvParser,
    UserTeamMappingCsvParser,
    UserTeamMappingImportService,
  ],
  exports: [UserVacationsImportService, UserTeamMappingImportService],
})
export class UserDataImportModule {}
