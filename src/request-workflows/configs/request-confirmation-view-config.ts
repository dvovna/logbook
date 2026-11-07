import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

export const REQUEST_CONFIRMATION_VIEW_CONFIG = {
  approve: {
    callbackId: ViewCallbackId.ApproveRequestStepMessage,
    title: 'Approve Request',
    message:
      'Approve this vacation request? It moves on to the next approvers, if there are any.',
  },
  reject: {
    callbackId: ViewCallbackId.RejectRequestStepMessage,
    title: 'Reject Request',
    message:
      'Reject this vacation request? The requester gets a message about it.',
  },
} as const;
