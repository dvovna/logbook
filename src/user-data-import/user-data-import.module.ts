import { UsersModule } from '../users/users.module';
import { Module } from '@nestjs/common';
import UserVacationsCsvParser from 'src/user-data-import/parsers/user-vacations-csv.parser';
import UserTeamsCsvParser from 'src/user-data-import/parsers/user-teams-csv.parser';
import { UserVacationsImportService } from 'src/user-data-import/user-vacations-import.service';
import { UserTeamsImportService } from 'src/user-data-import/user-teams-import.service';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
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
    UserTeamsImportService,
    UserTeamsCsvParser,
  ],
  controllers: [],
  exports: [UserVacationsImportService, UserTeamsImportService],
})
export class UserDataImportModule {}
