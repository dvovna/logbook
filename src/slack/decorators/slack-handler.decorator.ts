import { SetMetadata } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';

export const SLACK_HANDLER_METADATA = 'SLACK_HANDLER_METADATA';

export type SlackInteractionType =
  'block_actions' | 'view_submission' | 'view_closed';

export interface ISlackHandlerMeta {
  callbackId: string;
  type: SlackInteractionType;
  allowedRoles?: UserRole[];
}

export const SlackHandler = (meta: ISlackHandlerMeta): ClassDecorator =>
  SetMetadata(SLACK_HANDLER_METADATA, meta);
