import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from 'src/teams/services/teams.service';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';
import { CompanyRulesService } from 'src/teams/services/company-rules.service';
import { ValidationError } from 'src/common/errors/validation.error';

const SLACK_TEAM_ID = 'slack-team-1';
const POLICY_ID = 'policy-1';

describe('VacationPoliciesService', () => {
  let repository: Record<'findForDelete' | 'deleteMany', jest.Mock>;
  // Which calls ran inside TransactionService.transaction().
  let inTransaction: string[];
  let teamsService: { count: jest.Mock };
  let companyRulesService: { usesPolicy: jest.Mock };
  let service: VacationPoliciesService;
  let open = false;
  // A mock that answers `result` and notes whether it ran in the transaction.
  const track =
    (name: string, result?: unknown) =>
    async (..._args: unknown[]) => {
      if (open) {
        inTransaction.push(name);
      }

      return result;
    };

  beforeEach(() => {
    inTransaction = [];

    repository = {
      findForDelete: jest.fn(
        track('findForDelete', { id: POLICY_ID, slack_team_id: SLACK_TEAM_ID }),
      ),
      deleteMany: jest.fn(track('deleteMany')),
    };
    teamsService = { count: jest.fn(track('count', 0)) };
    companyRulesService = { usesPolicy: jest.fn(track('usesPolicy', false)) };
    const transactions = {
      transaction: async <T>(work: () => Promise<T>) => {
        open = true;

        try {
          return await work();
        } finally {
          open = false;
        }
      },
    };

    service = new VacationPoliciesService(
      repository as unknown as VacationPoliciesRepository,
      transactions as unknown as TransactionService,
      teamsService as unknown as TeamsService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {} as ConfigService,
      companyRulesService as unknown as CompanyRulesService,
    );
  });

  describe('delete', () => {
    it('deletes a policy that no team uses, checked under its lock', async () => {
      await service.delete({ id: POLICY_ID, slackTeamId: SLACK_TEAM_ID });

      expect(repository.findForDelete).toHaveBeenCalledWith(
        POLICY_ID,
        SLACK_TEAM_ID,
      );
      expect(inTransaction).toEqual([
        'findForDelete',
        'usesPolicy',
        'count',
        'deleteMany',
      ]);

      expect(teamsService.count).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        vacationPolicyId: POLICY_ID,
        ownRulesOnly: true,
      });
      expect(companyRulesService.usesPolicy).toHaveBeenCalledWith(
        POLICY_ID,
        SLACK_TEAM_ID,
      );
      expect(repository.deleteMany).toHaveBeenCalled();
    });

    it('refuses to delete a policy assigned to teams', async () => {
      teamsService.count.mockImplementation(track('count', 2));

      await expect(
        service.delete({ id: POLICY_ID, slackTeamId: SLACK_TEAM_ID }),
      ).rejects.toThrow(
        new EntityHasDependenciesError('policy', 'used by 2 teams'),
      );
      expect(repository.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses to delete the policy of the company rules', async () => {
      companyRulesService.usesPolicy.mockImplementation(
        track('usesPolicy', true),
      );

      await expect(
        service.delete({ id: POLICY_ID, slackTeamId: SLACK_TEAM_ID }),
      ).rejects.toThrow(
        new ValidationError(
          'The company rules use this policy. Choose another policy there first.',
        ),
      );
      expect(repository.deleteMany).not.toHaveBeenCalled();
    });
  });
});
