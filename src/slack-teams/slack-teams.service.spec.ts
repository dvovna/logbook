import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import UserRole from 'src/common/enums/user-role.enum';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { SlackTeamsRepository } from 'src/slack-teams/slack-teams.repository';
import { TokenCipherService } from 'src/slack-teams/token-cipher.service';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

describe('SlackTeamsService currency', () => {
  let repository: { update: jest.Mock };
  let service: SlackTeamsService;

  beforeEach(() => {
    repository = { update: jest.fn() };
    service = new SlackTeamsService(
      repository as unknown as SlackTeamsRepository,
      {} as TokenCipherService,
      {} as TransactionService,
    );
  });

  it("sets an admin's workspace's currency as an ISO 4217 code", async () => {
    await expect(
      service.setCurrency(' eur ', userWith(UserRole.Admin)),
    ).resolves.toBe('EUR');

    expect(repository.update).toHaveBeenCalledWith(
      { id: SLACK_TEAM_ID },
      { currency: 'EUR' },
    );
  });

  it('refuses a code ISO 4217 does not have', async () => {
    await expect(
      service.setCurrency('ABC', userWith(UserRole.Admin)),
    ).rejects.toMatchObject({ field: 'currency' });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
    'refuses a %s',
    async (role) => {
      await expect(service.setCurrency('EUR', userWith(role))).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    },
  );
});

describe('SlackTeamsService.deleteWorkspace', () => {
  let repository: { deleteMany: jest.Mock };
  let transactions: { transaction: jest.Mock; allowLongStatements: jest.Mock };
  let service: SlackTeamsService;
  let inTransaction: boolean;

  beforeEach(() => {
    inTransaction = false;
    repository = {
      deleteMany: jest.fn(() => {
        expect(inTransaction).toBe(true);

        return Promise.resolve(1);
      }),
    };
    transactions = {
      transaction: jest.fn(async (work: () => Promise<unknown>) => {
        inTransaction = true;

        try {
          return await work();
        } finally {
          inTransaction = false;
        }
      }),
      allowLongStatements: jest.fn(),
    };
    service = new SlackTeamsService(
      repository as unknown as SlackTeamsRepository,
      {} as TokenCipherService,
      transactions as unknown as TransactionService,
    );
  });

  it('deletes the workspace in a transaction of its own, with a long statement timeout', async () => {
    await expect(service.deleteWorkspace('workspace-1')).resolves.toBe(true);

    expect(transactions.allowLongStatements).toHaveBeenCalledWith(300);
    expect(repository.deleteMany).toHaveBeenCalledWith({ id: 'workspace-1' });
  });

  it('deletes it only while it is still uninstalled since before the cutoff', async () => {
    repository.deleteMany.mockResolvedValue(0);
    const cutoff = new Date('2026-05-18T12:00:00.000Z');

    await expect(service.deleteWorkspace('workspace-1', cutoff)).resolves.toBe(
      false,
    );

    expect(repository.deleteMany).toHaveBeenCalledWith({
      id: 'workspace-1',
      uninstalled_at: { operator: 'lt', value: '2026-05-18T12:00:00.000Z' },
    });
  });
});

describe('SlackTeamsService.saveRefreshedTokens', () => {
  const cipher = new TokenCipherService({
    getOrThrow: () => Buffer.alloc(32, 1).toString('base64'),
  } as unknown as ConfigService);
  let repository: { replaceTokens: jest.Mock };
  let service: SlackTeamsService;

  beforeEach(() => {
    repository = { replaceTokens: jest.fn().mockResolvedValue(true) };
    service = new SlackTeamsService(
      repository as unknown as SlackTeamsRepository,
      cipher,
      {} as TransactionService,
    );
  });

  const previous = {
    token: 'xoxe.xoxb-old',
    refreshToken: 'xoxe-1-old',
    expiresAt: new Date('2026-06-17T09:05:00.000Z'),
    storedRefreshToken: 'v1:as-stored',
  };
  const refreshed = {
    token: 'xoxe.xoxb-new',
    refreshToken: 'xoxe-1-new',
    expiresAt: new Date('2026-06-17T21:00:00.000Z'),
  };

  it('saves the new pair, encrypted, over the stored refresh token it replaces', async () => {
    await expect(
      service.saveRefreshedTokens('workspace-1', previous, refreshed),
    ).resolves.toBe(true);

    const [id, current, tokens] = repository.replaceTokens.mock.calls[0];
    expect([id, current]).toEqual(['workspace-1', 'v1:as-stored']);
    expect(cipher.decrypt(tokens.slack_token)).toBe('xoxe.xoxb-new');
    expect(cipher.decrypt(tokens.slack_refresh_token)).toBe('xoxe-1-new');
    expect(tokens.slack_token_expires_at).toBe('2026-06-17T21:00:00.000Z');
  });

  it('says when the stored pair changed since it was read', async () => {
    repository.replaceTokens.mockResolvedValue(false);

    await expect(
      service.saveRefreshedTokens('workspace-1', previous, refreshed),
    ).resolves.toBe(false);
  });

  it('saves nothing over a token that has no refresh token', async () => {
    await expect(
      service.saveRefreshedTokens(
        'workspace-1',
        { ...previous, storedRefreshToken: null },
        refreshed,
      ),
    ).resolves.toBe(false);
    expect(repository.replaceTokens).not.toHaveBeenCalled();
  });
});
