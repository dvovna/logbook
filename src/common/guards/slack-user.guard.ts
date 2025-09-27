import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from 'src/users/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';

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

    const user = await this.usersService.findBySlackId(slackUserId);

    if (!user) {
      this.logger.log('SlackUserGuard: User not found for slack_id', {
        slackUserId,
      });

      throw new UnauthorizedException('User not found.');
    }

    req.user = user;

    return true;
  }
}
