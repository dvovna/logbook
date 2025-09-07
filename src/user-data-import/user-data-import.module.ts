import { UsersModule } from '../users/users.module';
import { Module } from '@nestjs/common';
import UserVacationsCsvParser from 'src/user-data-import/parsers/user-vacations-csv.parser';
import { UserVacationsImportService } from 'src/user-data-import/user-vacations-import.service';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';

@Module({
  imports: [UsersModule, VacationRequestsModule, SlackCommunicationModule],
  providers: [UserVacationsImportService, UserVacationsCsvParser],
  controllers: [],
  exports: [UserVacationsImportService],
})
export class UserDataImportModule {}
