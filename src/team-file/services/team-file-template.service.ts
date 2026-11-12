import { Injectable } from '@nestjs/common';
import { csvText, toCsv } from '@common/utils/csv.utils';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { TEAM_FILE_HEADERS } from 'src/team-file/constants/team-file-headers';

// The file HR fills in: everyone active, with the team they are in now and
// whether they lead it.
@Injectable()
export class TeamFileTemplateService {
  public constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
  ) {}

  public async build(slackTeamId: string) {
    const [users, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const teamsById = new Map(teams.map((team) => [team.id, team]));

    const rows = users
      .map((user) => {
        const team = user.team_id ? teamsById.get(user.team_id) : undefined;

        return {
          name: user.name || user.email,
          email: user.email,
          team: team?.name ?? '',
          lead: !!team?.manager_approvers?.includes(user.slack_id),
        };
      })
      .sort(
        (a, b) =>
          Number(!a.team) - Number(!b.team) ||
          a.team.localeCompare(b.team) ||
          a.name.localeCompare(b.name),
      );

    return toCsv([
      [...TEAM_FILE_HEADERS],
      ...rows.map(({ name, email, team, lead }) =>
        [name, email, team, lead ? 'yes' : ''].map(csvText),
      ),
    ]);
  }
}
