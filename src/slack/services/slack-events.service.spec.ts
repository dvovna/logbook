import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { Logger } from '@nestjs/common';
import {
  DEFAULT_JOBS_OPTIONS,
  JobQueue,
  JobsService,
} from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import {
  startInBackground,
  whenBackgroundWorkIsDone,
} from '@common/utils/run-in-background';
import SlackEventsService, {
  ITeamJoinEvent,
  IUserChangeEvent,
  SlackEventJob,
} from 'src/slack/services/slack-events.service';
import FileUploadService from 'src/slack/services/file-upload.service';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { UsersService } from 'src/users/services/users.service';
import { SlackAppUninstallService } from 'src/slack/services/slack-app-uninstall.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { SlackEventReceiptsService } from 'src/slack-teams/slack-event-receipts.service';
import SlackEventType from 'src/slack/enums/slack-event-type.enum';
import UserRole from 'src/common/enums/user-role.enum';
import ISlackTeamViewModel from 'src/slack-teams/types/slack-team.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

const slackTeam: ISlackTeamViewModel = {
  id: 'b7a1c2d4-0000-4000-8000-000000000001',
  name: 'Acme',
  slack_id: 'T_ACME',
  created_at: '2026-01-01T00:00:00Z',
  currency: 'USD',
  time_off_minutes_per_day: 480,
  uninstalled_at: null,
  members_imported_at: null,
  team_told_at: null,
};

const slackUser = {
  id: 'U_NEW',
  team_id: slackTeam.slack_id,
  name: 'new.user',
  real_name: 'New User',
  profile: { email: 'new.user@example.com' },
  is_admin: false,
  is_owner: false,
  is_bot: false,
  deleted: false,
};

// Event handlers run as jobs, after the answer; wait for them.
const flushPromises = whenBackgroundWorkIsDone;

describe('SlackEventsService', () => {
  let usersService: {
    upsert: jest.Mock;
    refreshProfile: jest.Mock;
    findBySlackId: jest.Mock;
    findOne: jest.Mock;
  };
  let slackTeamsService: { findOneWithValidation: jest.Mock };
  let tabNavigationService: { navigate: jest.Mock };
  let loggerError: jest.SpyInstance;
  let send: jest.Mock;
  let takeOnce: jest.Mock;
  let service: SlackEventsService;

  beforeEach(() => {
    usersService = {
      upsert: jest.fn().mockResolvedValue(undefined),
      refreshProfile: jest.fn().mockResolvedValue(undefined),
      findBySlackId: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    };
    slackTeamsService = {
      findOneWithValidation: jest.fn().mockResolvedValue(slackTeam),
    };
    tabNavigationService = { navigate: jest.fn() };
    send = jest.fn().mockResolvedValue(null);
    // Every delivery is the first one.
    takeOnce = jest.fn(
      async (_workspace: string, _event: string, save: () => Promise<void>) => {
        await save();

        return true;
      },
    );
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new SlackEventsService(
      {} as FileUploadService,
      tabNavigationService as unknown as TabNavigationService,
      usersService as unknown as UsersService,
      {} as SlackAppUninstallService,
      slackTeamsService as unknown as SlackTeamsService,
      // A queue that saves nothing (pg-boss answers null): a job runs once,
      // at once. Outside a transaction, afterCommit starts it at once.
      new JobsService({ send } as unknown as JobQueue, DEFAULT_JOBS_OPTIONS, {
        sqlExecutor: () => ({}),
        afterCommit: (work: () => Promise<unknown>) =>
          void startInBackground(work),
      } as unknown as TransactionService),
      { takeOnce } as unknown as SlackEventReceiptsService,
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  // A crash after the answer finds the job saved: Slack sends an event it got
  // an answer for only once.
  it('saves the job before it answers', async () => {
    const response = await service.handleSlackEvent(
      { type: SlackEventType.TeamJoin, user: slackUser },
      undefined,
      { team_id: slackTeam.slack_id },
    );

    expect(response).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      SlackEventJob.TeamJoin,
      expect.objectContaining({ workspaceSlackId: slackTeam.slack_id }),
      expect.anything(),
    );
    await flushPromises();
  });

  it('saves no job for an event Slack delivered before', async () => {
    takeOnce.mockResolvedValue(false);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const response = await service.handleSlackEvent(
      {
        type: SlackEventType.FileShared,
        user_id: 'U_ADMIN',
        file_id: 'F1',
        channel_id: 'D1',
        team_id: slackTeam.slack_id,
      },
      undefined,
      { team_id: slackTeam.slack_id, event_id: 'Ev1' },
    );
    await flushPromises();

    expect(response).toEqual({ ok: true });
    expect(takeOnce).toHaveBeenCalledWith(
      slackTeam.slack_id,
      'Ev1',
      expect.any(Function),
    );
    expect(send).not.toHaveBeenCalled();
  });

  // Slack sends it again when it gets no answer.
  it('fails the answer when it cannot save the job', async () => {
    send.mockRejectedValue(new Error('db is down'));

    await expect(
      service.handleSlackEvent(
        { type: SlackEventType.TeamJoin, user: slackUser },
        undefined,
        {},
      ),
    ).rejects.toThrow('db is down');
    await flushPromises();

    expect(usersService.upsert).not.toHaveBeenCalled();
  });

  describe('background handlers', () => {
    it('logs a failed job instead of leaving its rejection unhandled', async () => {
      usersService.upsert.mockRejectedValue(new Error('db is down'));

      const response = await service.handleSlackEvent(
        { type: SlackEventType.TeamJoin, user: slackUser },
        undefined,
        {},
      );
      await flushPromises();

      expect(response).toEqual({ ok: true });
      expect(loggerError).toHaveBeenCalledWith(
        'Job slack-event-team-join failed: db is down',
        expect.any(String),
      );
    });

    it('does not render the home tab for a user unknown to the bot', () => {
      service.handleSlackEvent(
        {
          type: SlackEventType.HomeTabOpened,
          user: 'U_UNKNOWN',
          channel: 'D_UNKNOWN',
          tab: 'home',
        },
        undefined,
        {},
      );

      expect(tabNavigationService.navigate).not.toHaveBeenCalled();
    });
  });

  describe('team_join', () => {
    const sendTeamJoin = async (user: ITeamJoinEvent['user']) => {
      await service.handleSlackEvent(
        { type: SlackEventType.TeamJoin, user },
        undefined,
        { team_id: slackTeam.slack_id },
      );
      await flushPromises();
    };

    it('creates a member in the workspace the event comes from', async () => {
      await sendTeamJoin(slackUser);

      expect(slackTeamsService.findOneWithValidation).toHaveBeenCalledWith({
        slackId: slackTeam.slack_id,
      });
      expect(usersService.upsert).toHaveBeenCalledWith({
        slackId: 'U_NEW',
        role: UserRole.Member,
        email: 'new.user@example.com',
        name: 'New User',
        isActive: true,
        slackTeamId: slackTeam.id,
        contractStartDate: expect.any(Date),
      });
    });

    it.each([{ is_owner: true }, { is_admin: true }])(
      'creates a Slack admin or owner (%j) as a member',
      async (slackRole) => {
        await sendTeamJoin({ ...slackUser, ...slackRole });

        expect(usersService.upsert).toHaveBeenCalledWith(
          expect.objectContaining({ role: UserRole.Member }),
        );
      },
    );

    it('does not write the role of a person Logbook has', async () => {
      const existing = {
        id: 'user-1',
        role: UserRole.HR,
        is_active: true,
        slack_id: 'U_NEW',
        slack_team_id: slackTeam.id,
        email: 'old@example.com',
        name: 'Old Name',
      } as IUserViewModel;
      usersService.findOne.mockResolvedValue(existing);

      await service.handleSlackEvent(
        {
          type: SlackEventType.TeamJoin,
          user: { ...slackUser, is_owner: true },
        },
        existing,
        { team_id: slackTeam.slack_id },
      );
      await flushPromises();

      expect(usersService.upsert).not.toHaveBeenCalled();
      expect(usersService.refreshProfile).toHaveBeenCalledWith({
        slackId: 'U_NEW',
        email: 'new.user@example.com',
        name: 'New User',
        slackTeamId: slackTeam.id,
      });
    });
  });

  describe('user_change', () => {
    it('keeps the role and team of an existing user', async () => {
      const existingUser: IUserViewModel = {
        id: 'user-1',
        email: 'old@example.com',
        name: 'Old Name',
        role: UserRole.HR,
        is_active: true,
        team_id: 'team-1',
        slack_team_id: slackTeam.id,
        slack_id: 'U_NEW',
        created_at: '2026-01-01T00:00:00Z',
        time_reminder: TimeReminder.Weekly,
      };
      const event: IUserChangeEvent = {
        type: SlackEventType.UserChange,
        user: { ...slackUser, deleted: true },
      };
      // The job reads the user again when it runs.
      usersService.findOne.mockResolvedValue(existingUser);
      await service.handleSlackEvent(event, existingUser, {});
      await flushPromises();

      expect(usersService.findOne).toHaveBeenCalledWith({
        id: 'user-1',
        slackTeamId: slackTeam.id,
        includeInactive: true,
      });

      expect(usersService.upsert).not.toHaveBeenCalled();
      expect(usersService.refreshProfile).toHaveBeenCalledWith({
        slackId: 'U_NEW',
        email: 'new.user@example.com',
        name: 'New User',
        isActive: false,
        slackTeamId: slackTeam.id,
      });
    });
  });
});
