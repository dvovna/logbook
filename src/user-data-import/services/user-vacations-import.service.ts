import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import {
  IVacationsReplacement,
  VacationRequestsService,
} from '@modules/vacation-requests/services/vacation-requests.service';
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

// What became of one line of the file.
type LineOutcome =
  | { replacement: IVacationsReplacement; failure?: string }
  | { problem: string; skipped: boolean };

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

  // Every line in one transaction and a few statements, whatever their
  // number. When that fails, the lines are imported one at a time, each in a
  // transaction of its own, so that a line the database refuses is reported
  // and the others are imported.
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

    const outcomes = await this.plan(records, user);
    const replacements = outcomes.flatMap((outcome) =>
      'replacement' in outcome ? [outcome.replacement] : [],
    );

    try {
      // A person on several lines gets the last one, as when the lines were
      // imported one after another.
      await this.vacationsService.replaceVacations(
        [
          ...new Map(
            replacements.map((replacement) => [
              replacement.user.id,
              replacement,
            ]),
          ).values(),
        ],
        user,
      );
    } catch (error) {
      this.logger.error(
        'Failed to import the vacations at once, importing them line by line',
        error,
      );
      await this.importOneByOne(outcomes, user);
    }

    for (const outcome of outcomes) {
      if ('problem' in outcome) {
        result.errors.push(outcome.problem);
        result.skipped += outcome.skipped ? 1 : 0;
      } else if (outcome.failure !== undefined) {
        result.errors.push(
          `Failed to import ${outcome.replacement.user.email}: ${outcome.failure}`,
        );
        result.skipped++;
      } else {
        result.updated++;
      }
    }

    return result;
  }

  // Each line's vacations, or why it is left out, in the file's order. The
  // people are read at once.
  private async plan(
    records: IUserVacationRecord[],
    user: IUserViewModel,
  ): Promise<LineOutcome[]> {
    const people = await this.usersService.findMany({
      emails: [...new Set(records.map(({ email }) => email))],
      slackTeamId: user.slack_team_id,
    });
    const byEmail = new Map(people.map((person) => [person.email, person]));

    return records.map((record): LineOutcome => {
      if (record.vacations.length > MAX_ALLOWED_VACATIONS) {
        return {
          problem: `User can have a maximum of ${MAX_ALLOWED_VACATIONS} vacations. Skipping ${record.email}.`,
          skipped: false,
        };
      }

      const person = byEmail.get(record.email);

      if (!person) {
        return { problem: `User not found: ${record.email}`, skipped: true };
      }

      return {
        replacement: {
          user: person,
          vacations: record.vacations.map((vacation) => ({
            ...vacation,
            userId: person.id,
            teamId: person.team_id,
          })),
          contractStartDate: record.contractStartDate,
        },
      };
    });
  }

  private async importOneByOne(outcomes: LineOutcome[], user: IUserViewModel) {
    for (const outcome of outcomes) {
      if (!('replacement' in outcome)) {
        continue;
      }

      try {
        await this.vacationsService.replaceVacations(
          [outcome.replacement],
          user,
        );
      } catch (error) {
        this.logger.error('Failed to import a vacations row', error);
        outcome.failure = (error as Error).message;
      }
    }
  }
}
