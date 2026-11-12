import { Module } from '@nestjs/common';
import { UsersModule } from '@modules/users/users.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { UserVacationsImportService } from '@modules/user-data-import/services/user-vacations-import.service';
import UserVacationsCsvParser from '@modules/user-data-import/parsers/user-vacations-csv.parser';

@Module({
  imports: [
    UsersModule,
    TeamsModule,
    VacationRequestsModule,
    SlackCommunicationModule,
  ],
  providers: [UserVacationsImportService, UserVacationsCsvParser],
  exports: [UserVacationsImportService],
})
export class UserDataImportModule {}
