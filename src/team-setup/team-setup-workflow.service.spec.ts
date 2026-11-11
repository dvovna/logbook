import {
  DEFAULT_JOBS_OPTIONS,
  JobQueue,
  JobsService,
} from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import { Logger } from '@nestjs/common';
import { NEW_PERSON_PROMPT_JOB } from 'src/team-file/constants/jobs';
import { TeamSetupWorkflowService } from 'src/team-setup/team-setup-workflow.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { UsersService } from 'src/users/services/users.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import { TeamUsersSyncService } from 'src/team-setup/team-users-sync.service';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

const SLACK_TEAM_ID = 'b7a1c2d4-0000-4000-8000-000000000001';

describe('TeamSetupWorkflowService', () => {
  let teamUsersSyncService: { syncUsers: jest.Mock };
  let slackTeamsService: {
    findOne: jest.Mock;
    createWorkspace: jest.Mock;
    findOneWithValidation: jest.Mock;
    markMembersImported: jest.Mock;
  };
  let jobs: JobsService;
  let loggerError: jest.SpyInstance;
  let service: TeamSetupWorkflowService;

  beforeEach(() => {
    jest.useFakeTimers();

    slackTeamsService = {
      findOneWithValidation: jest
        .fn()
        .mockResolvedValue({ members_imported_at: null }),
      markMembersImported: jest.fn().mockResolvedValue(true),
      findOne: jest.fn().mockResolvedValue(null),
      createWorkspace: jest.fn().mockResolvedValue({ id: SLACK_TEAM_ID }),
    };
    const usersService = {
      create: jest.fn().mockResolvedValue({ slack_id: 'U_ADMIN' }),
    };
    const slackUsersService = {
      getUserWithToken: jest.fn().mockResolvedValue({
        user: { profile: { email: 'admin@example.com', real_name: 'Admin' } },
      }),
    };
    teamUsersSyncService = { syncUsers: jest.fn() };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    jobs = new JobsService(
      { send: () => Promise.resolve(null) } as unknown as JobQueue,
      DEFAULT_JOBS_OPTIONS,
      {} as TransactionService,
    );

    service = new TeamSetupWorkflowService(
      slackTeamsService as unknown as SlackTeamsService,
      usersService as unknown as UsersService,
      slackUsersService as unknown as SlackUsersService,
      teamUsersSyncService as unknown as TeamUsersSyncService,
      { forget: jest.fn() } as unknown as AccessTokenService,
      // A queue that saves nothing (pg-boss answers null): a job runs once,
      // at once.
      jobs,
      { postMessage: jest.fn() } as unknown as SlackCommunicationService,
      {
        transaction: <T>(work: () => Promise<T>) => work(),
      } as unknown as TransactionService,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // Records the jobs; the prompt job has no handler here, so it only counts.
  const spyOnRun = () => {
    const run = jobs.run.bind(jobs);

    return jest
      .spyOn(jobs, 'run')
      .mockImplementation((name, payload) =>
        name === NEW_PERSON_PROMPT_JOB ? Promise.resolve() : run(name, payload),
      );
  };

  const setupTeam = () =>
    service.execute({
      slackTeamId: 'T_ACME',
      slackTeamName: 'Acme',
      tokens: { token: 'xoxb-test' },
      slackUserId: 'U_ADMIN',
    });

  it('syncs the rest of the workspace users in the background', async () => {
    teamUsersSyncService.syncUsers.mockResolvedValue([]);

    await setupTeam();
    expect(teamUsersSyncService.syncUsers).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(5000);

    expect(teamUsersSyncService.syncUsers).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      userSlackIdsToIgnore: ['U_ADMIN'],
    });
  });

  it('logs a failed sync job instead of leaving its rejection unhandled', async () => {
    teamUsersSyncService.syncUsers.mockRejectedValue(new Error('ratelimited'));

    await setupTeam();
    await jest.advanceTimersByTimeAsync(5000);

    expect(loggerError).toHaveBeenCalledWith(
      'Job team-sync-users failed: ratelimited',
      expect.any(String),
    );
  });

  it('asks about nothing on the first import, and marks it done', async () => {
    teamUsersSyncService.syncUsers.mockResolvedValue([{ id: 'user-1' }]);
    const run = spyOnRun();

    await setupTeam();
    await jest.advanceTimersByTimeAsync(5000);

    expect(run).not.toHaveBeenCalledWith(
      NEW_PERSON_PROMPT_JOB,
      expect.anything(),
    );
    expect(slackTeamsService.markMembersImported).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
    );
  });

  it('asks about each person a later import adds', async () => {
    slackTeamsService.findOneWithValidation.mockResolvedValue({
      members_imported_at: '2026-06-01T00:00:00Z',
    });
    teamUsersSyncService.syncUsers.mockResolvedValue([
      { id: 'user-1' },
      { id: 'user-2' },
    ]);
    const run = spyOnRun();

    await setupTeam();
    await jest.advanceTimersByTimeAsync(5000);

    expect(
      run.mock.calls.filter(([name]) => name === NEW_PERSON_PROMPT_JOB),
    ).toEqual([
      [NEW_PERSON_PROMPT_JOB, { slackTeamId: SLACK_TEAM_ID, userId: 'user-1' }],
      [NEW_PERSON_PROMPT_JOB, { slackTeamId: SLACK_TEAM_ID, userId: 'user-2' }],
    ]);
  });
});
