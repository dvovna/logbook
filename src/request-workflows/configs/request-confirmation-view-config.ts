import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

export const REQUEST_CONFIRMATION_VIEW_CONFIG = {
  approve: {
    callbackId: ViewCallbackId.ApproveRequestStepMessage,
    title: 'Approve & Continue',
    message: 'Are you sure you want to approve this vacation request step?',
  },
  reject: {
    callbackId: ViewCallbackId.RejectRequestStepMessage,
    title: 'Reject Vacation Request',
    message: 'Are you sure you want to reject this vacation request?',
  },
} as const;
