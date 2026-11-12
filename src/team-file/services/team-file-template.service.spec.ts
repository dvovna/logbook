import { IUserViewModel } from '@modules/users/types/user.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { TeamFileTemplateService } from 'src/team-file/services/team-file-template.service';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';

const person = (fields: Partial<IUserViewModel>) =>
  ({ team_id: null, ...fields }) as IUserViewModel;

const team = (fields: Partial<ITeamViewModel>) =>
  ({ manager_approvers: null, ...fields }) as ITeamViewModel;

const lines = (csv: string) =>
  csv.replace('\uFEFF', '').replace(/\r\n$/, '').split('\r\n');

describe('TeamFileTemplateService.build', () => {
  const build = (users: IUserViewModel[], teams: ITeamViewModel[]) => {
    const usersService = {
      findMany: jest.fn().mockResolvedValue(users),
    } as unknown as UsersService;
    const teamsService = {
      findMany: jest.fn().mockResolvedValue(teams),
    } as unknown as TeamsService;

    return new TeamFileTemplateService(usersService, teamsService).build(
      'workspace-1',
    );
  };

  it('lists active people with their team and lead mark, teams sorted, people without a team last', async () => {
    const csv = await build(
      [
        person({ id: 'u1', slack_id: 'U1', name: 'Zed', email: 'z@x.test' }),
        person({
          id: 'u2',
          slack_id: 'U2',
          name: 'Bob',
          email: 'b@x.test',
          team_id: 'design',
        }),
        person({
          id: 'u3',
          slack_id: 'U3',
          name: 'Ann',
          email: 'a@x.test',
          team_id: 'design',
        }),
        person({
          id: 'u4',
          slack_id: 'U4',
          name: 'Cy',
          email: 'c@x.test',
          team_id: 'backend',
        }),
        person({ id: 'u5', slack_id: 'U5', name: 'Al', email: 'al@x.test' }),
      ],
      [
        // U1 manages Design but is not in it, so is no lead.
        team({ id: 'design', name: 'Design', manager_approvers: ['U3', 'U1'] }),
        team({ id: 'backend', name: 'Backend' }),
      ],
    );

    expect(lines(csv)).toEqual([
      'Name,Email,Team,Team lead',
      'Cy,c@x.test,Backend,',
      'Ann,a@x.test,Design,yes',
      'Bob,b@x.test,Design,',
      'Al,al@x.test,,',
      'Zed,z@x.test,,',
    ]);
  });

  it('writes the email of a person with no name as their name', async () => {
    const csv = await build(
      [person({ id: 'u1', slack_id: 'U1', name: '', email: 'e@x.test' })],
      [],
    );

    expect(lines(csv)).toEqual([
      'Name,Email,Team,Team lead',
      'e@x.test,e@x.test,,',
    ]);
  });

  it('reads back as the names it wrote, those that start like a formula too', async () => {
    const csv = await build(
      [
        person({
          id: 'u1',
          slack_id: 'U1',
          name: '=Ann',
          email: 'a@x.test',
          team_id: 'mobile',
        }),
      ],
      [team({ id: 'mobile', name: '@Mobile', manager_approvers: ['U1'] })],
    );

    expect(
      parseTeamFile(await readSpreadsheet(Buffer.from(csv), 'team-setup.csv')),
    ).toEqual([
      { row: 2, name: '=Ann', email: 'a@x.test', team: '@Mobile', lead: 'yes' },
    ]);
  });

  it('escapes a cell that starts like a formula', async () => {
    const csv = await build(
      [person({ id: 'u1', slack_id: 'U1', name: '=1+1', email: 'e@x.test' })],
      [],
    );

    expect(lines(csv)).toEqual([
      'Name,Email,Team,Team lead',
      "'=1+1,e@x.test,,",
    ]);
  });
});
