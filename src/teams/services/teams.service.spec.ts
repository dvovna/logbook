import ITeamViewModel from '@modules/teams/types/team.interface';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { APPROVERS_CHANGED } from '@modules/users/events/users.events';

// A transaction that runs its work; `inTransaction` says whether an event
// came inside one.
const fakeTransactions = () => {
  const state = { inTransaction: false };

  return {
    state,
    transactions: {
      transaction: async <T>(work: () => Promise<T>) => {
        state.inTransaction = true;

        try {
          return await work();
        } finally {
          state.inTransaction = false;
        }
      },
    },
  };
};

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
    const eventEmitter = { emitAsync: jest.fn() };
    const service = new TeamsService(
      teamsRepository as never,
      ruleSetsRepository as never,
      config as never,
      fakeTransactions().transactions as never,
      eventEmitter as never,
    );

    return { service, teamsRepository, eventEmitter };
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

  // A request keeps the team it was made in: a new team has none.
  it('tells nobody of its approvers', async () => {
    const { service, eventEmitter } = setup();

    await service.create(
      { name: 'A', slackTeamId: 'ws-1', managerApprovers: ['U_LEAD'] },
      user,
    );

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });
});

describe('TeamsService.update', () => {
  const user = { id: 'user-1', slack_team_id: 'ws-1' } as IUserViewModel;

  // The team as it is before the change: a lead and its own rules.
  const setup = (
    before: Partial<ITeamViewModel> = {
      manager_approvers: ['U_LEAD'],
      hr_approvers: ['U_HR'],
      rule_set_id: null,
    },
  ) => {
    const teamsRepository = {
      findOne: jest.fn().mockResolvedValue({ id: 'team-1', ...before }),
      update: jest.fn().mockResolvedValue({ id: 'team-1' }),
      replaceApprovers: jest.fn().mockResolvedValue({ id: 'team-1' }),
    };
    const ruleSetsRepository = {
      ensureDefault: jest.fn().mockResolvedValue({ id: 'set-1' }),
    };
    const { state, transactions } = fakeTransactions();
    // Whether each event came inside the transaction of the write.
    const emittedInTransaction: boolean[] = [];
    const eventEmitter = {
      emitAsync: jest.fn(() => {
        emittedInTransaction.push(state.inTransaction);

        return Promise.resolve([]);
      }),
    };
    const service = new TeamsService(
      teamsRepository as never,
      ruleSetsRepository as never,
      {} as never,
      transactions as never,
      eventEmitter as never,
    );

    return { service, teamsRepository, eventEmitter, emittedInTransaction };
  };

  it('followsCompanyRules false clears rule_set_id, true sets the default set', async () => {
    const { service, teamsRepository } = setup();

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

  // The requests that waited for anyone who can approve them are looked at
  // again, in a job saved with the change.
  it.each([
    { managerApprovers: ['U_LEAD', 'U_NEW'] },
    { followsCompanyRules: false, hrApprovers: ['U_NEW'] },
    { followsCompanyRules: true, managerApprovers: ['U_LEAD'] },
  ])('tells of someone new it names: %j', async (params) => {
    const { service, eventEmitter, emittedInTransaction } = setup();

    await service.update({ id: 'team-1', slackTeamId: 'ws-1' }, params, user);

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(APPROVERS_CHANGED, {
      slackTeamId: 'ws-1',
    });
    expect(emittedInTransaction).toEqual([true]);
  });

  // A save of the form that keeps the approvers, or takes some away, is
  // a plain write.
  it.each([
    { name: 'Design' },
    { followsCompanyRules: false, managerApprovers: [], hrApprovers: [] },
    {
      name: 'Design',
      followsCompanyRules: false,
      managerApprovers: ['U_LEAD'],
      hrApprovers: ['U_HR'],
    },
  ])('tells nothing when it names nobody new: %j', async (params) => {
    const { service, eventEmitter, emittedInTransaction } = setup();

    await service.update({ id: 'team-1', slackTeamId: 'ws-1' }, params, user);

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    expect(emittedInTransaction).toEqual([]);
  });

  it('tells nothing when a team that follows the company rules is saved again', async () => {
    const { service, eventEmitter } = setup({
      manager_approvers: ['U_LEAD'],
      rule_set_id: 'set-1',
    });

    await service.update(
      { id: 'team-1', slackTeamId: 'ws-1' },
      { followsCompanyRules: true, managerApprovers: ['U_LEAD'] },
      user,
    );

    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('tells of the leads an Undo puts back', async () => {
    const { service, eventEmitter, emittedInTransaction } = setup();

    expect(
      await service.replaceApprovers('team-1', ['U_NEW'], ['U_OLD'], user),
    ).toBe(true);
    expect(await service.replaceApprovers('team-1', ['U_OLD'], [], user)).toBe(
      true,
    );

    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
    expect(emittedInTransaction).toEqual([true]);
  });
});
