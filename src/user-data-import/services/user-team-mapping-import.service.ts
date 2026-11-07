import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import UserTeamMappingCsvParser, {
  IUserTeamRecord,
} from '@modules/user-data-import/parsers/user-team-mapping-csv.parser';
import { IUserViewModel } from '@modules/users/types/user.interface';

export interface ITeamsImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

const MAX_RECORDS = 1000;

@Injectable()
export class UserTeamMappingImportService {
  private readonly logger = new Logger(UserTeamMappingImportService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly userTeamsCsvParser: UserTeamMappingCsvParser,
  ) {}

  public async handle(
    fileContent: string,
    user: IUserViewModel,
  ): Promise<ITeamsImportResult> {
    const result: ITeamsImportResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    let records: IUserTeamRecord[];

    try {
      records = await this.userTeamsCsvParser.parseCsv(fileContent);

      if (records.length > MAX_RECORDS) {
        result.errors.push(
          `Too many records to process. Limit is ${MAX_RECORDS}`,
        );
        return result;
      }
    } catch (error) {
      this.logger.error('CSV parsing failed', error);
      result.errors.push(
        `Failed to import user team mapping: ${error.message}`,
      );
      return result;
    }

    for (const record of records) {
      try {
        const existingUser = await this.usersService.findOne({
          email: record.email,
          slackTeamId: user.slack_team_id,
        });

        if (!existingUser) {
          result.skipped++;
          result.errors.push(`User not found: ${record.email}`);
          continue;
        }

        const team = await this.teamsService.findOne({
          name: record.team_name,
          slackTeamId: user.slack_team_id,
        });

        if (!team) {
          result.skipped++;
          result.errors.push(`Team not found: ${record.team_name}`);
          continue;
        }

        if (existingUser.team_id === team.id) {
          result.skipped++;
          continue;
        }

        await this.usersService.update(
          {
            id: existingUser.id,
            slackTeamId: existingUser.slack_team_id,
          },
          {
            teamId: team.id,
          },
          user,
        );

        if (existingUser.team_id) {
          result.updated++;
        } else {
          result.created++;
        }
      } catch (error) {
        this.logger.error('Failed to import a team mapping row', error);

        result.errors.push(
          `Failed to import ${record.email}: ${error.message}`,
        );

        result.skipped++;
      }
    }

    return result;
  }
}
