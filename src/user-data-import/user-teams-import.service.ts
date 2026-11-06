import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/services/users.service';
import TeamsService from 'src/teams/services/teams.service';
import UserTeamsCsvParser, {
  IUserTeamRecord,
} from 'src/user-data-import/parsers/user-teams-csv.parser';
import { IUserViewModel } from 'src/users/types/user.interface';
import ITeamViewModel from 'src/teams/types/team.interface';

export interface IUserTeamsImportResult {
  updated: number;
  unchanged: number;
  skipped: number;
  errors: string[];
}

const MAX_RECORDS = 1000;

const normalizeTeamName = (name: string) => name.trim().toLowerCase();

// Assigns workspace users to teams from `user-teams.csv` (`email,team`).
@Injectable()
export class UserTeamsImportService {
  private readonly logger = new Logger(UserTeamsImportService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly userTeamsCsvParser: UserTeamsCsvParser,
  ) {}

  public async handle(
    fileContent: string,
    importedBy: IUserViewModel,
  ): Promise<IUserTeamsImportResult> {
    const result: IUserTeamsImportResult = {
      updated: 0,
      unchanged: 0,
      skipped: 0,
      errors: [],
    };

    let records: IUserTeamRecord[];

    try {
      records = await this.userTeamsCsvParser.parseCsv(fileContent);
    } catch (error) {
      this.logger.warn(`User teams CSV is invalid: ${error.message}`);
      result.errors.push(`Failed to import user teams: ${error.message}`);

      return result;
    }

    if (records.length > MAX_RECORDS) {
      result.errors.push(
        `Too many records to process. Limit is ${MAX_RECORDS}`,
      );

      return result;
    }

    const findTeam = await this.getTeamFinder(importedBy.slack_team_id);

    for (const record of records) {
      const { team, error } = findTeam(record.team);

      if (!team) {
        result.skipped++;
        result.errors.push(
          error === 'ambiguous'
            ? `Team name is used by several teams, rename them first: ${record.team}`
            : `Team not found for ${record.email}: ${record.team}`,
        );
        continue;
      }

      try {
        const user = await this.usersService.findOne({
          email: record.email,
          slackTeamId: importedBy.slack_team_id,
        });

        if (!user) {
          result.skipped++;
          result.errors.push(`User not found: ${record.email}`);
          continue;
        }

        if (user.team_id === team.id) {
          result.unchanged++;
          continue;
        }

        await this.usersService.update(
          { id: user.id, slackTeamId: importedBy.slack_team_id },
          { teamId: team.id },
          importedBy,
        );

        result.updated++;
      } catch (error) {
        this.logger.error(
          `Failed to update the team of ${record.email}`,
          error.stack,
        );
        result.skipped++;
        result.errors.push(
          `Failed to update ${record.email}: ${error.message}`,
        );
      }
    }

    return result;
  }

  private async getTeamFinder(slackTeamId: string) {
    const teams = await this.teamsService.findMany({ slackTeamId });
    const teamsByName = new Map<string, ITeamViewModel[]>();

    for (const team of teams) {
      const key = normalizeTeamName(team.name);
      teamsByName.set(key, [...(teamsByName.get(key) ?? []), team]);
    }

    return (
      name: string,
    ): { team?: ITeamViewModel; error?: 'not_found' | 'ambiguous' } => {
      const matches = teamsByName.get(normalizeTeamName(name)) ?? [];

      if (matches.length > 1) {
        return { error: 'ambiguous' };
      }

      return matches[0] ? { team: matches[0] } : { error: 'not_found' };
    };
  }
}
