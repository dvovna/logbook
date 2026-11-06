import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { IUserViewModel } from '@modules/users/types/user.interface';

interface ISlackRequest extends Request {
  user: IUserViewModel;
}

@Injectable()
export class SlackActiveUserGuard implements CanActivate {
  private readonly logger = new Logger(SlackActiveUserGuard.name);

  public canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<ISlackRequest>();

    if (!req.user) {
      throw new ForbiddenException('User not resolved by SlackUserGuard');
    }

    if (!req.user.is_active) {
      this.logger.log(`SlackActiveUserGuard: User ${req.user.id} is inactive`);
      throw new ForbiddenException('User is inactive.');
    }

    return true;
  }
}
