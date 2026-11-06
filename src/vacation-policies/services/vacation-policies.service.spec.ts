import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import HolidaysService from 'src/holidays/services/holidays.service';
import TeamsService from 'src/teams/services/teams.service';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';

const SLACK_TEAM_ID = 'slack-team-1';
const POLICY_ID = 'policy-1';

describe('VacationPoliciesService', () => {
  let repository: Record<'findOne' | 'deleteMany', jest.Mock>;
  let holidaysService: { deleteMany: jest.Mock };
  let teamsService: { count: jest.Mock };
  let service: VacationPoliciesService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue({
        id: POLICY_ID,
        slack_team_id: SLACK_TEAM_ID,
      }),
      deleteMany: jest.fn(),
    };
    holidaysService = { deleteMany: jest.fn() };
    teamsService = { count: jest.fn().mockResolvedValue(0) };

    service = new VacationPoliciesService(
      repository as unknown as VacationPoliciesRepository,
      holidaysService as unknown as HolidaysService,
      teamsService as unknown as TeamsService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      {} as ConfigService,
    );
  });

  describe('delete', () => {
    it('deletes a policy that no team uses, with its holidays', async () => {
      await service.delete({ id: POLICY_ID, slackTeamId: SLACK_TEAM_ID });

      expect(teamsService.count).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        vacationPolicyId: POLICY_ID,
      });
      expect(repository.deleteMany).toHaveBeenCalled();
      expect(holidaysService.deleteMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        vacationPolicyId: POLICY_ID,
      });
    });

    it('refuses to delete a policy assigned to teams', async () => {
      teamsService.count.mockResolvedValue(2);

      await expect(
        service.delete({ id: POLICY_ID, slackTeamId: SLACK_TEAM_ID }),
      ).rejects.toThrow(
        new EntityHasDependenciesError('policy', 'used by 2 teams'),
      );
      expect(repository.deleteMany).not.toHaveBeenCalled();
      expect(holidaysService.deleteMany).not.toHaveBeenCalled();
    });
  });
});
