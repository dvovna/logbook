import { Injectable, Logger } from '@nestjs/common';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { WebAPICallResult } from '@slack/web-api';
import delay from '@common/utils/delay';

interface ISlackMember {
  id: string;
  email: string;
  real_name: string;
  is_bot: boolean;
  deleted: boolean;
  profile: {
    email: string;
  };
}

type IUserProfilesListResponseData = WebAPICallResult & {
  members: ISlackMember[];
};

type IUserProfileResponseData = WebAPICallResult & {
  user: {
    id: string;
    profile: ISlackMember;
  };
};

const GET_USERS_LIMIT = 100;
const SLACK_BOT_ID = 'USLACKBOT';

// A Slack account the app keeps as a user: a person with an email, not a bot
// or Slackbot. The member import and team_join both go by it.
export const isPersonWithEmail = (member: {
  id: string;
  is_bot?: boolean;
  profile?: { email?: string };
}) => !member.is_bot && member.id !== SLACK_BOT_ID && !!member.profile?.email;

@Injectable()
export default class SlackUsersService {
  private readonly logger = new Logger(SlackUsersService.name);

  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly slackApiClient: SlackApiClient,
  ) {}

  // With a token the app hasn't stored yet: the installer, before the
  // workspace exists.
  public async getUserWithToken(userId: string, accessToken: string) {
    return this.slackApiClient.makeCall<IUserProfileResponseData>(
      'users.info',
      { user: userId },
      accessToken,
    );
  }

  public async getUser(userId: string, teamId: string) {
    return this.slackCommunicationService.makeCall<IUserProfileResponseData>(
      'users.info',
      {
        user: userId,
      },
      teamId,
    );
  }

  public async getExistingUsers(teamId: string) {
    const allUsers: ISlackMember[] = [];
    let cursor: string | undefined = undefined;

    do {
      try {
        const response =
          await this.slackCommunicationService.makeCall<IUserProfilesListResponseData>(
            'users.list',
            {
              limit: GET_USERS_LIMIT,
              cursor,
            },
            teamId,
          );

        if (!response.ok) {
          throw new Error('Failed to fetch Slack users');
        }

        allUsers.push(...response.members);
        cursor = response.response_metadata?.next_cursor;
      } catch (error) {
        if (!error?.response?.headers?.['retry-after']) {
          throw error;
        }

        const retryAfterSeconds = Number(
          error?.response.headers['retry-after'],
        );

        this.logger.warn(`Rate limit hit, retrying in ${retryAfterSeconds}s`);

        await delay(retryAfterSeconds * 1000);
      }
    } while (cursor);

    return allUsers.filter((user) => !user.deleted && isPersonWithEmail(user));
  }
}
