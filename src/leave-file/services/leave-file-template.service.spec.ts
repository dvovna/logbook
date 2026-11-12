import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { LeaveFileTemplateService } from 'src/leave-file/services/leave-file-template.service';

const person = (fields: Partial<IUserViewModel>) =>
  ({ team_id: null, contract_start_date: null, ...fields }) as IUserViewModel;

const lines = (csv: string) =>
  csv.replace('﻿', '').replace(/\r\n$/, '').split('\r\n');

describe('LeaveFileTemplateService', () => {
  const service = (users: IUserViewModel[], teams: ITeamViewModel[]) =>
    new LeaveFileTemplateService(
      {
        findMany: jest.fn().mockResolvedValue(users),
      } as unknown as UsersService,
      {
        findMany: jest.fn().mockResolvedValue(teams),
      } as unknown as TeamsService,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-06-17T10:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lists people sorted by team then name, the one without a team last, dated today', async () => {
    const csv = await service(
      [
        person({ name: 'Zed', email: 'z@x.test' }),
        person({
          name: 'Bob',
          email: 'b@x.test',
          team_id: 'design',
          contract_start_date: '2024-03-01T00:00:00.000Z',
        }),
      ],
      [{ id: 'design', name: 'Design' } as ITeamViewModel],
    ).balances('workspace-1');

    expect(lines(csv)).toEqual([
      'Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left',
      'Bob,b@x.test,2024-03-01,2026-06-17,,,',
      'Zed,z@x.test,,2026-06-17,,,',
    ]);
  });

  it('writes the email of a person with no name as their name', async () => {
    const csv = await service(
      [person({ name: '', email: 'e@x.test' })],
      [],
    ).balances('workspace-1');

    expect(lines(csv)[1]).toBe('e@x.test,e@x.test,,2026-06-17,,,');
  });

  it('has only the headers in the history template', () => {
    expect(lines(service([], []).history())).toEqual([
      'Name,Email,Leave type,From,To,Comment',
    ]);
  });
});
