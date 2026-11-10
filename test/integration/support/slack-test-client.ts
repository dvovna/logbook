import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { View } from '@slack/types/dist/views';
import { TEST_SLACK_SIGNING_SECRET } from './test-env';
import { actionPayload, fillForm, findAction, SlackJson } from './block-kit';
import {
  errorsResponseProblems,
  suggestionsProblems,
  viewProblems,
} from './block-kit-rules';
import {
  reportDisplayProblems,
  reportSlackViolation,
} from './slack-violations';
import { viewDisplayProblems } from './block-kit-display-rules';
import { IPostedMessage } from './fake-slack-api.client';

export interface ISlackActor {
  slack_id: string;
}

export interface ISlackWorkspace {
  slackId: string;
}

const triggerId = () => `trigger-${randomUUID()}`;

// Slack shows a request as failed when the app has not answered within 3
// seconds; leave room for the network.
const ANSWER_TIME_LIMIT_MS = 2500;

// What Slack would refuse in the answer to an interaction: a view the
// modal is updated to or pushed, or errors for fields the view lacks.
const answerProblems = (payload: SlackJson, answer: unknown) => {
  const body = answer as SlackJson | undefined;

  switch (body?.response_action) {
    case 'update':
    case 'push':
      return viewProblems(body.view);
    case 'errors':
      return errorsResponseProblems(payload.view, body.errors);
    default:
      return [];
  }
};

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
    ).expect((response) => {
      reportSlackViolation(
        `answer to ${payload.type}`,
        answerProblems(payload, response.body),
      );
      reportDisplayProblems(
        `answer to ${payload.type}`,
        ['update', 'push'].includes(response.body?.response_action)
          ? viewDisplayProblems(response.body.view)
          : [],
      );
    });
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

  // What Slack sends while the user types `value` into an external select of
  // `view`; the response body holds the options the app suggests.
  public suggest(
    workspace: ISlackWorkspace,
    user: ISlackActor,
    view: View,
    actionId: string,
    value: string,
  ) {
    const { blockId } = findAction(view.blocks, actionId);

    return this.post(
      '/api/slack/options',
      new URLSearchParams({
        payload: JSON.stringify({
          type: 'block_suggestion',
          team: { id: workspace.slackId },
          user: { id: user.slack_id },
          action_id: actionId,
          block_id: blockId,
          value,
          view: { team_id: workspace.slackId, ...view },
        }),
      }).toString(),
      'application/x-www-form-urlencoded',
    ).expect((response) =>
      reportSlackViolation(
        'answer to block_suggestion',
        suggestionsProblems(response.body),
      ),
    );
  }

  // `forgedState`: state values for blocks the view doesn't have, as a
  // client could send them, merged into what fillForm builds.
  public submitView(
    workspace: ISlackWorkspace,
    user: ISlackActor,
    view: View,
    values: Record<string, string | string[] | undefined> = {},
    forgedState: Record<string, Record<string, unknown>> = {},
  ) {
    return this.interaction({
      type: 'view_submission',
      team: { id: workspace.slackId },
      user: { id: user.slack_id },
      trigger_id: triggerId(),
      view: {
        team_id: workspace.slackId,
        ...view,
        state: { values: { ...fillForm(view, values), ...forgedState } },
      },
    });
  }

  private post(path: string, body: string, contentType: string) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const sentAt = performance.now();
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
      .send(body)
      .expect(() => {
        const answeredAfter = performance.now() - sentAt;

        if (answeredAfter > ANSWER_TIME_LIMIT_MS) {
          throw new Error(
            `${path} answered after ${Math.round(answeredAfter)} ms; Slack gives up after 3 seconds. Run slow work with runInBackground.`,
          );
        }
      });
  }
}
