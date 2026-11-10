import { ForbiddenException } from '@nestjs/common';
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
