import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';

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

    const user = await this.usersService.findBySlackId(slackUserId);

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
}
