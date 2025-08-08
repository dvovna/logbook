import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';
import { Actionable } from '@slack/web-api';

export interface ISlackInteractionPayload {
  type: string;
  trigger_id: string;
  view: {
    team_id: string;
    callback_id: ViewCallbackId;
    private_metadata: string;
    state: {
      values: IViewStateValues;
    };
  };
  actions: Actionable[];
  user: {
    id: string;
  };
}
