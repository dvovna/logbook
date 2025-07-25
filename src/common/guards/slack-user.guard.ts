import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from 'src/users/users.service';

@Injectable()
export class SlackUserGuard implements CanActivate {
  private readonly logger = new Logger(SlackUserGuard.name);

  public constructor(private readonly usersService: UsersService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const slackUserId = req.body.user_id || req.body.event?.user_id;

    if (!slackUserId) {
      this.logger.log('SlackUserGuard: Missing slack user id');
      return true;
    }

    const user = await this.usersService.findOne({ slackId: slackUserId });

    if (!user) {
      this.logger.log('SlackUserGuard: User not found for slack_id', {
        slackUserId,
      });

      throw new UnauthorizedException('User not found for this slack_id');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).user = user;

    return true;
  }
}
