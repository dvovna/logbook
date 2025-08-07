// src/common/decorators/require-role.decorator.ts
import { SetMetadata } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';

export const REQUIRED_ROLES_KEY = 'requiredRoles';
export const RequireRoles = (roles: UserRole[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
