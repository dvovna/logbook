import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import UserRole from 'src/common/enums/user-role.enum';
import { REQUIRED_ROLES_KEY } from 'src/common/decorators/user-role.decorator';

@Injectable()
export class UserRoleGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || !requiredRoles.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        slack_id: user.slack_id,
        team_id: user.slack_team_id,
        requiredRoles,
      });
    }

    return true;
  }
}
