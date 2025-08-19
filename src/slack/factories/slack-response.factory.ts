import { View } from '@slack/web-api';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';

export enum SlackViewResponseAction {
  Errors = 'errors',
  Update = 'update',
  Push = 'push',
  Clear = 'clear',
}

export default class SlackViewResponseFactory {
  public static success(): ViewResponseAction {
    return {
      response_action: SlackViewResponseAction.Clear,
    };
  }

  public static errors(errors: Record<string, string>): ViewResponseAction {
    return {
      response_action: SlackViewResponseAction.Errors,
      errors,
    };
  }

  public static update(view: View): ViewResponseAction {
    return {
      response_action: SlackViewResponseAction.Update,
      view,
    };
  }

  public static push(view: View): ViewResponseAction {
    return {
      response_action: SlackViewResponseAction.Push,
      view,
    };
  }
}
