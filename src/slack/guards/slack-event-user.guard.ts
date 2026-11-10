import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
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
export class SlackEventUserGuard implements CanActivate {
  public constructor(private readonly usersService: UsersService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ISlackRequest>();
    const body = req.body;

    if (body.type === 'url_verification') {
      return true;
    }

    const slackUserId = this.getUserId(req);

    if (!slackUserId) {
      return true;
    }

    const user = await this.findWorkspaceUser(slackUserId, body);

    if (!user) {
      return true;
    }

    req.user = user;

    return true;
  }

  private getUserId({ body }: ISlackRequest) {
    if (typeof body.event.user === 'object') {
      return body.event.user.id;
    }

    return (
      body.user_id || body.event?.user_id || body.event?.user || body.user?.id
    );
  }

  // The same Slack user ID can exist in several workspaces, so the user is
  // looked up in the workspace the request comes from.
  private async findWorkspaceUser(
    slackUserId: string,
    body: ISlackRequestWorkspace,
  ): Promise<IUserViewModel | null> {
    const workspaceSlackId = getRequestWorkspaceSlackId(body);

    if (!workspaceSlackId) {
      return null;
    }

    const { user } = await this.usersService.findInWorkspaceBySlackIds(
      workspaceSlackId,
      slackUserId,
    );

    return user;
  }
}
