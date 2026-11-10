import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

describe('TeamsService.create', () => {
  const user = { id: 'user-1' } as IUserViewModel;

  const setup = () => {
    const teamsRepository = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: 'team-1' }),
    };
    const ruleSetsRepository = {
      ensureDefault: jest.fn().mockResolvedValue({ id: 'set-1' }),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue(10) };
    const service = new TeamsService(
      teamsRepository as never,
      ruleSetsRepository as never,
      config as never,
    );

    return { service, teamsRepository };
  };

  it('sets rule_set_id to the default set unless followsCompanyRules is false', async () => {
    const { service, teamsRepository } = setup();

    await service.create({ name: 'A', slackTeamId: 'ws-1' }, user);
    await service.create(
      { name: 'B', slackTeamId: 'ws-1', followsCompanyRules: false },
      user,
    );

    expect(teamsRepository.create.mock.calls[0][0].rule_set_id).toBe('set-1');
    expect(teamsRepository.create.mock.calls[1][0].rule_set_id).toBeNull();
  });
});

describe('TeamsService.update', () => {
  const user = { id: 'user-1' } as IUserViewModel;

  it('followsCompanyRules false clears rule_set_id, true sets the default set', async () => {
    const teamsRepository = {
      update: jest.fn().mockResolvedValue({ id: 'team-1' }),
    };
    const ruleSetsRepository = {
      ensureDefault: jest.fn().mockResolvedValue({ id: 'set-1' }),
    };
    const service = new TeamsService(
      teamsRepository as never,
      ruleSetsRepository as never,
      {} as never,
    );

    await service.update(
      { id: 'team-1', slackTeamId: 'ws-1' },
      { followsCompanyRules: false },
      user,
    );
    await service.update(
      { id: 'team-1', slackTeamId: 'ws-1' },
      { followsCompanyRules: true },
      user,
    );
    await service.update({ id: 'team-1', slackTeamId: 'ws-1' }, {}, user);

    const sets = teamsRepository.update.mock.calls.map((call) => call[1]);
    expect(sets[0].rule_set_id).toBeNull();
    expect(sets[1].rule_set_id).toBe('set-1');
    expect('rule_set_id' in sets[2]).toBe(false);
  });
});
