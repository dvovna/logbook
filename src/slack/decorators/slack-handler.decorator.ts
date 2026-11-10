import { SetMetadata } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

export const SLACK_HANDLER_METADATA = 'SLACK_HANDLER_METADATA';

export type SlackInteractionType =
  'block_actions' | 'view_submission' | 'view_closed';

export interface ISlackHandlerMeta {
  callbackId: ViewCallbackId;
  type: SlackInteractionType;
  // Who may use the handler; required, so a new handler is closed until it
  // says who may use it (ALL_ROLES for everyone).
  allowedRoles: readonly UserRole[];
}

export const SlackHandler = (meta: ISlackHandlerMeta): ClassDecorator =>
  SetMetadata(SLACK_HANDLER_METADATA, meta);
