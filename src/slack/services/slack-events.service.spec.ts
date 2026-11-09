import { Logger } from '@nestjs/common';
import {
  DEFAULT_JOBS_OPTIONS,
  JobQueue,
  JobsService,
} from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import SlackEventsService, {
  ITeamJoinEvent,
  IUserChangeEvent,
} from 'src/slack/services/slack-events.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import FileUploadService from 'src/slack/services/file-upload.service';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { UsersService } from 'src/users/services/users.service';
import { SlackAppUninstallService } from 'src/slack/services/slack-app-uninstall.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import SlackEventType from 'src/slack/enums/slack-event-type.enum';
import UserRole from 'src/common/enums/user-role.enum';
import ISlackTeamViewModel from 'src/slack-teams/types/slack-team.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

const slackTeam: ISlackTeamViewModel = {
  id: 'b7a1c2d4-0000-4000-8000-000000000001',
  name: 'Acme',
  slack_id: 'T_ACME',
  created_at: '2026-01-01T00:00:00Z',
  uninstalled_at: null,
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
    findBySlackId: jest.Mock;
    findOne: jest.Mock;
  };
  let slackTeamsService: { findOneWithValidation: jest.Mock };
  let tabNavigationService: { navigate: jest.Mock };
  let loggerError: jest.SpyInstance;
  let service: SlackEventsService;

  beforeEach(() => {
    usersService = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findBySlackId: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    };
    slackTeamsService = {
      findOneWithValidation: jest.fn().mockResolvedValue(slackTeam),
    };
    tabNavigationService = { navigate: jest.fn() };
    loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    service = new SlackEventsService(
      {} as SlackUserAccessService,
      {} as FileUploadService,
      tabNavigationService as unknown as TabNavigationService,
      usersService as unknown as UsersService,
      {} as SlackAppUninstallService,
      slackTeamsService as unknown as SlackTeamsService,
      // A queue that saves nothing (pg-boss answers null): a job runs once,
      // at once.
      new JobsService(
        { send: () => Promise.resolve(null) } as unknown as JobQueue,
        DEFAULT_JOBS_OPTIONS,
        {} as TransactionService,
      ),
    );
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

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
        teamId: null,
        role: UserRole.Member,
        email: 'new.user@example.com',
        name: 'New User',
        isActive: true,
        slackTeamId: slackTeam.id,
        contractStartDate: expect.any(Date),
      });
    });

    it('creates workspace admins and owners as admins', async () => {
      await sendTeamJoin({ ...slackUser, is_owner: true });

      expect(usersService.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ role: UserRole.Admin }),
      );
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
      };
      const event: IUserChangeEvent = {
        type: SlackEventType.UserChange,
        user: { ...slackUser, deleted: true },
      };
      // The job reads the user again when it runs.
      usersService.findOne.mockResolvedValue(existingUser);
      service.handleSlackEvent(event, existingUser, {});
      await flushPromises();

      expect(usersService.findOne).toHaveBeenCalledWith({
        id: 'user-1',
        slackTeamId: slackTeam.id,
        includeInactive: true,
      });

      expect(usersService.upsert).toHaveBeenCalledWith({
        slackId: 'U_NEW',
        teamId: 'team-1',
        role: UserRole.HR,
        email: 'new.user@example.com',
        name: 'New User',
        isActive: false,
        slackTeamId: slackTeam.id,
      });
    });
  });
});
