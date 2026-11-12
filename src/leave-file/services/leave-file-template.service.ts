import { Injectable } from '@nestjs/common';
import { csvText, toCsv } from '@common/utils/csv.utils';
import { getDateOnly } from '@common/utils/date.utils';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import {
  BALANCES_HEADERS,
  HISTORY_HEADERS,
} from 'src/leave-file/constants/leave-file-headers';

// The files HR fills in: everyone active with their contract start and a
// Balance on date of today, and an empty history.
@Injectable()
export class LeaveFileTemplateService {
  public constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
  ) {}

  public async balances(slackTeamId: string): Promise<string> {
    const [users, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    const today = getDateOnly(new Date());

    const rows = users
      .map((user) => ({
        name: user.name || user.email,
        email: user.email,
        team: (user.team_id && teamNames.get(user.team_id)) || '',
        contractStart: user.contract_start_date?.slice(0, 10) ?? '',
      }))
      .sort(
        (a, b) =>
          Number(!a.team) - Number(!b.team) ||
          a.team.localeCompare(b.team) ||
          a.name.localeCompare(b.name),
      );

    return toCsv([
      [...BALANCES_HEADERS],
      ...rows.map(({ name, email, contractStart }) =>
        [name, email, contractStart, today, '', '', ''].map(csvText),
      ),
    ]);
  }

  public history(): string {
    return toCsv([[...HISTORY_HEADERS]]);
  }
}
