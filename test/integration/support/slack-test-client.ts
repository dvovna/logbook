import { createHmac, randomUUID } from 'crypto';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { View } from '@slack/types/dist/views';
import { TEST_SLACK_SIGNING_SECRET } from './test-env';
import { actionPayload, fillForm, findAction } from './block-kit';
import { IPostedMessage } from './fake-slack-api.client';

export interface ISlackActor {
  slack_id: string;
}

export interface ISlackWorkspace {
  slackId: string;
}

const triggerId = () => `trigger-${randomUUID()}`;

// Slack only needs a 2xx within 3 seconds; the exact code doesn't matter.
export const acknowledged = (response: request.Response) => {
  if (response.status >= 300) {
    throw new Error(
      `Slack request failed with ${response.status}: ${response.text}`,
    );
  }
};

// Sends requests the way Slack does: signed with the signing secret, events as
// JSON, slash commands and interactions as form posts.
export class SlackTestClient {
  public constructor(private readonly server: App) {}

  public event(workspace: ISlackWorkspace, event: Record<string, unknown>) {
    return this.rawEvent({
      type: 'event_callback',
      team_id: workspace.slackId,
      api_app_id: 'A_TEST',
      event_id: `Ev${randomUUID().slice(0, 8)}`,
      event_time: Math.floor(Date.now() / 1000),
      event,
    });
  }

  // An Events API body as is, e.g. the url_verification handshake.
  public rawEvent(body: Record<string, unknown>) {
    return this.post(
      '/api/slack/events',
      JSON.stringify(body),
      'application/json',
    );
  }

  // `path` is the request URL configured for the command, e.g. `/api/slack/vacations`.
  public command(
    path: string,
    workspace: ISlackWorkspace,
    user: ISlackActor,
    text = '',
  ) {
    return this.post(
      path,
      new URLSearchParams({
        command: `/${path.split('/').pop()}`,
        text,
        team_id: workspace.slackId,
        user_id: user.slack_id,
        channel_id: 'C_TEST',
        trigger_id: triggerId(),
        response_url: 'https://hooks.slack.test/commands',
      }).toString(),
      'application/x-www-form-urlencoded',
    );
  }

  public interaction(payload: Record<string, unknown>) {
    return this.post(
      '/api/slack/interactions',
      new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
      'application/x-www-form-urlencoded',
    );
  }

  // A click or a choice in an App Home tab or a modal.
  public actOnView(
    workspace: ISlackWorkspace,
    user: ISlackActor,
    view: View,
    actionId: string,
    value?: string,
  ) {
    const action = findAction(view.blocks, actionId, value);

    return this.interaction({
      type: 'block_actions',
      team: { id: workspace.slackId },
      user: { id: user.slack_id },
      trigger_id: triggerId(),
      container: { type: 'view' },
      view: { team_id: workspace.slackId, ...view },
      actions: [actionPayload(action, value)],
    });
  }

  // A button click in a message the app posted.
  public actOnMessage(
    workspace: ISlackWorkspace,
    user: ISlackActor,
    message: IPostedMessage,
    actionId: string,
  ) {
    const action = findAction(message.blocks ?? [], actionId);

    return this.interaction({
      type: 'block_actions',
      team: { id: workspace.slackId },
      user: { id: user.slack_id },
      trigger_id: triggerId(),
      container: { type: 'message', message_ts: message.ts },
      channel: { id: message.channel },
      message: { ts: message.ts, text: message.text, blocks: message.blocks },
      actions: [actionPayload(action)],
    });
  }

  public submitView(
    workspace: ISlackWorkspace,
    user: ISlackActor,
    view: View,
    values: Record<string, string | string[] | undefined> = {},
  ) {
    return this.interaction({
      type: 'view_submission',
      team: { id: workspace.slackId },
      user: { id: user.slack_id },
      trigger_id: triggerId(),
      view: {
        team_id: workspace.slackId,
        ...view,
        state: { values: fillForm(view, values) },
      },
    });
  }

  private post(path: string, body: string, contentType: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac('sha256', TEST_SLACK_SIGNING_SECRET)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');

    // Node's global agent keeps connections alive; one the server closes
    // while the next request picks it up fails with ECONNRESET.
    return request(this.server)
      .post(path)
      .set('Connection', 'close')
      .set('Content-Type', contentType)
      .set('X-Slack-Request-Timestamp', timestamp)
      .set('X-Slack-Signature', `v0=${signature}`)
      .send(body);
  }
}
