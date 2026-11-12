import { EventEmitter2 } from '@nestjs/event-emitter';
import UserRole from '@common/enums/user-role.enum';
import { TransactionService } from 'src/database/transaction.service';
import {
  APPROVERS_CHANGED,
  ApproversChangedEvent,
  USER_ACCESS_CHANGED,
  USER_TEAM_CHANGED,
  UserAccessChangedEvent,
  UserTeamChangedEvent,
} from '@modules/users/events/users.events';
import { UsersRepository } from '@modules/users/repositories/users.repository';
import { UserUpdateValidatorService } from '@modules/users/services/user-update-validator.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

const hr = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const user = (id: string, teamId: string | null, role = UserRole.Member) =>
  ({
    id,
    role,
    team_id: teamId,
    slack_team_id: 'workspace-1',
  }) as IUserViewModel;

describe('UsersService', () => {
  const build = () => {
    const calls: string[] = [];
    const repository = {
      assignTeams: jest.fn(async () => {
        calls.push('assign');

        return [] as IUserViewModel[];
      }),
      setTeamMembers: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    const transactions = {
      transaction: jest.fn(async (work: () => Promise<unknown>) => {
        calls.push('begin');
        const result = await work();
        calls.push('commit');

        return result;
      }),
    };
    const eventEmitter = {
      emit: jest.fn(() => {
        calls.push('emit');

        return true;
      }),
      emitAsync: jest.fn(() => {
        calls.push('emitAsync');

        return Promise.resolve([]);
      }),
    };
    const service = new UsersService(
      repository as unknown as UsersRepository,
      {
        validate: jest.fn(),
      } as unknown as UserUpdateValidatorService,
      transactions as unknown as TransactionService,
      eventEmitter as unknown as EventEmitter2,
    );

    return { service, repository, transactions, eventEmitter, calls };
  };

  describe('assignTeams', () => {
    it('moves the users in one transaction and tells of each user whose team changed', async () => {
      const { service, repository, eventEmitter, calls } = build();
      repository.assignTeams.mockImplementation(async () => {
        calls.push('assign');

        return [user('ann', 'acme'), user('bo', null)];
      });
      const assignments = [
        { userId: 'ann', teamId: 'acme' },
        { userId: 'bo', teamId: null },
        { userId: 'cy', teamId: 'acme' },
      ];

      await service.assignTeams(assignments, hr);

      expect(repository.assignTeams).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
        assignments,
        updatedBy: 'hr-1',
      });
      expect(calls).toEqual(['begin', 'assign', 'emit', 'emit', 'commit']);
      expect(eventEmitter.emit.mock.calls).toEqual([
        [
          USER_TEAM_CHANGED,
          new UserTeamChangedEvent('ann', 'workspace-1', 'acme', 'hr-1'),
        ],
        [
          USER_TEAM_CHANGED,
          new UserTeamChangedEvent('bo', 'workspace-1', null, 'hr-1'),
        ],
      ]);
    });

    it('does nothing without assignments', async () => {
      const { service, repository, eventEmitter } = build();

      await service.assignTeams([], hr);

      expect(repository.assignTeams).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('setTeamMembers', () => {
    it('tells of each user who joined or left the team', async () => {
      const { service, repository, eventEmitter } = build();
      repository.setTeamMembers.mockResolvedValue([
        user('ann', null),
        user('bo', 'acme'),
      ]);

      await service.setTeamMembers('acme', ['bo'], hr);

      expect(eventEmitter.emit.mock.calls).toEqual([
        [
          USER_TEAM_CHANGED,
          new UserTeamChangedEvent('ann', 'workspace-1', null, 'hr-1'),
        ],
        [
          USER_TEAM_CHANGED,
          new UserTeamChangedEvent('bo', 'workspace-1', 'acme', 'hr-1'),
        ],
      ]);
    });
  });

  describe('update', () => {
    it.each([
      ['another team', 'beta', true],
      ['no team', null, true],
      ['the same team', 'acme', false],
      ['no team change', undefined, false],
    ])(
      'tells of a team change when the user moves to %s',
      async (_case, teamId, tells) => {
        const { service, repository, eventEmitter } = build();
        repository.findOne.mockResolvedValue(user('ann', 'acme'));
        repository.update.mockResolvedValue(
          user('ann', teamId === undefined ? 'acme' : teamId),
        );

        await service.update(
          { id: 'ann', slackTeamId: 'workspace-1' },
          { teamId, name: 'Ann' },
          hr,
        );

        expect(eventEmitter.emit.mock.calls).toEqual(
          tells
            ? [
                [
                  USER_TEAM_CHANGED,
                  new UserTeamChangedEvent(
                    'ann',
                    'workspace-1',
                    teamId ?? null,
                    'hr-1',
                  ),
                ],
              ]
            : [],
        );
      },
    );
  });

  // The listener saves the job that hands their approvals over with it.
  it('tells of a deactivation inside the transaction that writes it', async () => {
    const { service, repository, eventEmitter, calls } = build();
    repository.findOne.mockResolvedValue(user('ann', 'acme', UserRole.Manager));
    repository.update.mockImplementation(async () => {
      calls.push('update');

      return { ...user('ann', 'acme', UserRole.Manager), is_active: false };
    });

    await service.update(
      { id: 'ann', slackTeamId: 'workspace-1' },
      { isActive: false },
      hr,
    );

    expect(calls).toEqual(['begin', 'update', 'emitAsync', 'commit']);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      USER_ACCESS_CHANGED,
      new UserAccessChangedEvent('ann', 'workspace-1'),
    );
  });

  // The requests that waited for anyone who can approve them may go to them
  // now; they have no approvals to hand over.
  it.each<[string, { role?: UserRole; isActive?: boolean }, IUserViewModel]>([
    ['gets the HR role', { role: UserRole.HR }, user('ann', 'acme')],
    [
      'is made active again',
      { isActive: true },
      { ...user('ann', 'acme', UserRole.Manager), is_active: false },
    ],
  ])(
    'tells of an approver inside the transaction when someone %s',
    async (_case, changes, before) => {
      const { service, repository, eventEmitter, calls } = build();
      repository.findOne.mockResolvedValue(before);
      repository.update.mockImplementation(async () => {
        calls.push('update');

        return {
          ...before,
          role: changes.role ?? before.role,
          is_active: true,
        };
      });

      await service.update(
        { id: 'ann', slackTeamId: 'workspace-1' },
        changes,
        hr,
      );

      expect(calls).toEqual(['begin', 'update', 'emitAsync', 'commit']);
      expect(eventEmitter.emitAsync.mock.calls).toEqual([
        [APPROVERS_CHANGED, new ApproversChangedEvent('workspace-1')],
      ]);
    },
  );

  it('needs no transaction for a change that leaves access alone', async () => {
    const { service, repository, transactions, eventEmitter } = build();
    repository.findOne.mockResolvedValue(user('ann', 'acme'));
    repository.update.mockResolvedValue(user('ann', 'acme'));

    await service.update(
      { id: 'ann', slackTeamId: 'workspace-1' },
      { name: 'Ann' },
      hr,
    );

    expect(transactions.transaction).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  describe('makeManagers', () => {
    it('makes only the Members of the workspace among them Managers', async () => {
      const { service, repository } = build();
      repository.updateMany.mockResolvedValue([
        user('ann', null, UserRole.Manager),
      ]);

      const promoted = await service.makeManagers(['ann', 'cy'], hr);

      expect(promoted.map(({ id }) => id)).toEqual(['ann']);
      expect(repository.updateMany).toHaveBeenCalledWith(
        {
          slack_team_id: 'workspace-1',
          id: { operator: 'in', value: ['ann', 'cy'] },
          role: UserRole.Member,
        },
        {
          role: UserRole.Manager,
          updated_at: expect.any(String),
          updated_by: 'hr-1',
        },
      );
    });

    it('tells of the new approvers once, in the transaction', async () => {
      const { service, repository, eventEmitter, calls } = build();
      repository.updateMany.mockResolvedValue([
        { ...user('ann', null, UserRole.Manager), is_active: true },
        { ...user('bo', null, UserRole.Manager), is_active: true },
      ]);

      await service.makeManagers(['ann', 'bo'], hr);

      expect(calls).toEqual(['begin', 'emitAsync', 'commit']);
      expect(eventEmitter.emitAsync.mock.calls).toEqual([
        [APPROVERS_CHANGED, new ApproversChangedEvent('workspace-1')],
      ]);
    });

    it('does nothing without users', async () => {
      const { service, repository } = build();

      await expect(service.makeManagers([], hr)).resolves.toEqual([]);
      expect(repository.updateMany).not.toHaveBeenCalled();
    });
  });
});
