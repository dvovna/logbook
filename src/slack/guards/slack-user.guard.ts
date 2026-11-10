import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SlackUserAccessException } from '@common/errors/slack-user-access.exception';
import { Request } from 'express';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  getRequestWorkspaceSlackId,
  ISlackRequestWorkspace,
} from '@common/utils/slack-request.utils';

interface ISlackRequest extends Request {
  user: IUserViewModel;
}

@Injectable()
export class SlackUserGuard implements CanActivate {
  private readonly logger = new Logger(SlackUserGuard.name);

  public constructor(private readonly usersService: UsersService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ISlackRequest>();
    const body = req.body;

    const slackUserId =
      body.user_id ||
      body.event?.user_id ||
      body.event?.user?.id ||
      body.user?.id;

    if (!slackUserId) {
      this.logger.log('SlackUserGuard: Missing slack user id');
      return true;
    }

    const { workspaceId, user } = await this.findWorkspaceUser(
      slackUserId,
      body,
    );

    if (!user) {
      this.logger.log('SlackUserGuard: User not found for slack_id', {
        slackUserId,
      });

      throw new SlackUserAccessException(
        'unknown',
        slackUserId,
        workspaceId ?? undefined,
      );
    }

    req.user = user;

    return true;
  }

  // The same Slack user ID can exist in several workspaces, so the user is
  // looked up in the workspace the request comes from.
  private async findWorkspaceUser(
    slackUserId: string,
    body: ISlackRequestWorkspace,
  ) {
    const workspaceSlackId = getRequestWorkspaceSlackId(body);

    return workspaceSlackId
      ? this.usersService.findInWorkspaceBySlackIds(
          workspaceSlackId,
          slackUserId,
        )
      : { workspaceId: null, user: null };
  }
}
