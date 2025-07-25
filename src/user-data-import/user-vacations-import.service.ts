import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { VacationsService } from '../vacations/vacations.service';
import UserVacationsCsvParser, {
  IUserVacationRecord,
} from 'src/user-data-import/parsers/user-vacations-csv.parser';
import { IUserViewModel } from 'src/users/types/user.interface';

export interface IImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const MAX_RECORDS = 1000; // Limit for the number of records to process
const MAX_ALLOWED_VACATIONS = 1000;

@Injectable()
export class UserVacationsImportService {
  private readonly logger = new Logger(UserVacationsImportService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly vacationsService: VacationsService,
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
        });

        if (!existingUser) {
          result.skipped++;
          result.errors.push(`User not found: ${record.email}`);
          continue;
        }

        await this.usersService.update(existingUser.id, {
          contractStartDate: record.contractStartDate.toString(),
        });

        await this.vacationsService.replaceUserVacations(
          existingUser.id,
          record.vacations,
          user,
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
