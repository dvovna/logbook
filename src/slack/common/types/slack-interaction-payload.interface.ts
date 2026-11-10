import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IViewStateValues } from '@modules/slack/common/types/slack-view-state-values.interface';
import type { BlockElementAction } from '@slack/bolt/dist/types/actions/block-action';

export interface ISlackUser {
  id: string;
}

export interface ISlackView {
  // The view Slack shows: what views.update replaces.
  id?: string;
  team_id: string;
  callback_id: ViewCallbackId;
  private_metadata: string;
  state?: {
    values: IViewStateValues;
  };
}

/**
 * Block action (button click, select in block etc.)
 */
export interface ISlackBlockActionPayload {
  type: 'block_actions';
  trigger_id: string;
  user: ISlackUser;
  team?: { id: string };
  actions: BlockElementAction[];
  view: ISlackView;
}

/**
 * View submission (submit in modal view)
 */
export interface ISlackViewSubmissionPayload {
  type: 'view_submission';
  trigger_id: string;
  user: ISlackUser;
  team?: { id: string };
  view: ISlackView;
}

export type ISlackInteractionPayload =
  ISlackBlockActionPayload | ISlackViewSubmissionPayload;
