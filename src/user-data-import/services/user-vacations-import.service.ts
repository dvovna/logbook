import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import UserVacationsCsvParser, {
  IUserVacationRecord,
} from '@modules/user-data-import/parsers/user-vacations-csv.parser';
import { IUserViewModel } from '@modules/users/types/user.interface';

export interface IImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const MAX_RECORDS = 1000; // Limit for the number of records to process
const MAX_ALLOWED_VACATIONS = 100;

@Injectable()
export class UserVacationsImportService {
  private readonly logger = new Logger(UserVacationsImportService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly vacationsService: VacationRequestsService,
    private readonly userVacationsCsvParser: UserVacationsCsvParser,
  ) {}

  public async handle(
    fileContent: string,
    user: IUserViewModel,
  ): Promise<IImportResult> {
    const result: IImportResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    let records: IUserVacationRecord[];

    try {
      records = await this.userVacationsCsvParser.parseCsv(fileContent);

      if (records.length > MAX_RECORDS) {
        result.errors.push(
          'Too many records to process. Limit is ' + MAX_RECORDS,
        );

        return result;
      }
    } catch (error) {
      this.logger.error('CSV parsing failed', error);

      result.errors.push(`Failed to import user vacations: ${error.message}`);

      return result;
    }

    for (const record of records) {
      try {
        if (record.vacations.length > MAX_ALLOWED_VACATIONS) {
          result.errors.push(
            `User can have a maximum of ${MAX_ALLOWED_VACATIONS} vacations. Skipping ${record.email}.`,
          );

          continue;
        }

        const existingUser = await this.usersService.findOne({
          email: record.email,
          slackTeamId: user.slack_team_id,
        });

        if (!existingUser) {
          result.skipped++;
          result.errors.push(`User not found: ${record.email}`);
          continue;
        }

        await this.vacationsService.replaceUserVacations(
          existingUser,
          record.vacations.map((vacation) => ({
            ...vacation,
            userId: existingUser.id,
            teamId: existingUser.team_id,
          })),
          user,
        );

        // Only once the vacations are in: a failed import changes nothing.
        await this.usersService.update(
          {
            id: existingUser.id,
            slackTeamId: existingUser.slack_team_id,
          },
          {
            contractStartDate: record.contractStartDate,
          },
        );

        result.updated++;
      } catch (error) {
        this.logger.error(
          `Failed to import vacations for ${record.email}`,
          error,
        );

        result.errors.push(
          `Failed to import ${record.email}: ${error.message}`,
        );

        result.skipped++;
      }
    }

    return result;
  }
}
