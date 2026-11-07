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
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
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

  public constructor(
    private readonly usersService: UsersService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

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

    const workspace = await this.findWorkspace(body);
    const user = workspace
      ? await this.usersService.findBySlackId(slackUserId, workspace.id)
      : null;

    if (!user) {
      this.logger.log('SlackUserGuard: User not found for slack_id', {
        slackUserId,
      });

      throw new SlackUserAccessException('unknown', slackUserId, workspace?.id);
    }

    req.user = user;

    return true;
  }

  // The same Slack user ID can exist in several workspaces, so the user is
  // looked up in the workspace the request comes from.
  private async findWorkspace(body: ISlackRequestWorkspace) {
    const workspaceSlackId = getRequestWorkspaceSlackId(body);

    return workspaceSlackId
      ? await this.slackTeamsService.findOne({ slackId: workspaceSlackId })
      : null;
  }
}
