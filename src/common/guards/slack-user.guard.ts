import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
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

    const user = await this.findWorkspaceUser(slackUserId, body);

    if (!user) {
      this.logger.log('SlackUserGuard: User not found for slack_id', {
        slackUserId,
      });

      throw new UnauthorizedException('User not found.');
    }

    req.user = user;

    return true;
  }

  // The same Slack user ID can exist in several workspaces, so the user is
  // looked up in the workspace the request comes from.
  private async findWorkspaceUser(
    slackUserId: string,
    body: ISlackRequestWorkspace,
  ): Promise<IUserViewModel | null> {
    const workspaceSlackId = getRequestWorkspaceSlackId(body);
    const workspace = workspaceSlackId
      ? await this.slackTeamsService.findOne({ slackId: workspaceSlackId })
      : null;

    if (!workspace) {
      return null;
    }

    return this.usersService.findBySlackId(slackUserId, workspace.id);
  }
}
