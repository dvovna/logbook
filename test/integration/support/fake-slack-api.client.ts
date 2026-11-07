import { randomUUID } from 'crypto';
import { View } from '@slack/types/dist/views';
import {
  ViewsOpenArguments,
  ViewsPublishArguments,
} from '@slack/web-api/dist/types/request/views';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { SlackJson } from './block-kit';
import { messageProblems, viewProblems } from './block-kit-rules';
import { reportSlackViolation } from './slack-violations';

export interface ISlackApiCall {
  // Slack Web API method, e.g. `chat.postMessage` or `views.publish`.
  method: string;
  token?: string;
  params: SlackJson;
  // What the fake answered, for the calls whose answer the app uses.
  result?: SlackJson;
}

export interface IPostedMessage {
  // The user or channel ID the app posted to.
  to: string;
  // The channel and ts Slack answered with: what a click on it refers to.
  channel: string;
  ts: string;
  text?: string;
  blocks?: SlackJson[];
}

interface ISince {
  // Only look at calls made after this mark().
  since?: number;
}

export interface IFakeSlackUser {
  id: string;
  teamId: string;
  name: string;
  email: string;
  isAdmin?: boolean;
  isBot?: boolean;
  deleted?: boolean;
}

export interface IFakeOauthGrant {
  teamId: string;
  teamName: string;
  botToken: string;
  installerId: string;
}

type PublicMethods<T> = Pick<T, keyof T>;

// The real client returns Slack's response types; the fake answers with plain
// JSON of the same shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlackResponse = any;

// Stands in for SlackApiClient, the app's only way out to Slack. It records
// every call and answers the few read methods the app uses from data the test
// registered (users, files, OAuth codes).
export class FakeSlackApiClient implements PublicMethods<SlackApiClient> {
  public readonly calls: ISlackApiCall[] = [];

  private readonly users = new Map<string, IFakeSlackUser>();
  private readonly files = new Map<string, { name: string; content: string }>();
  private readonly oauthGrants = new Map<string, IFakeOauthGrant>();
  private messageCount = 0;

  // --- test setup -----------------------------------------------------------

  public addUser(user: IFakeSlackUser) {
    this.users.set(user.id, user);
  }

  public addFile(name: string, content: string) {
    const id = `F${randomUUID().slice(0, 8).toUpperCase()}`;
    this.files.set(id, { name, content });

    return id;
  }

  public addOauthGrant(code: string, grant: IFakeOauthGrant) {
    this.oauthGrants.set(code, grant);
  }

  // --- assertions -----------------------------------------------------------

  // The current position in the call log, for `since`.
  public mark() {
    return this.calls.length;
  }

  public callsWith(token: string, method?: string, { since = 0 }: ISince = {}) {
    return this.calls
      .slice(since)
      .filter(
        (call) => call.token === token && (!method || call.method === method),
      );
  }

  // The App Home view last published for a user.
  public homeView(token: string, slackUserId: string, options?: ISince): View {
    const publish = this.callsWith(token, 'views.publish', options)
      .filter((call) => call.params.user_id === slackUserId)
      .pop();

    if (!publish) {
      throw new Error(`No App Home was published for ${slackUserId}`);
    }

    return publish.params.view;
  }

  // The modal last opened in the workspace.
  public openedModal(token: string, options?: ISince): View {
    const open = this.callsWith(token, 'views.open', options).pop();

    if (!open) {
      throw new Error('No modal was opened');
    }

    return open.params.view;
  }

  public postedMessages(
    token: string,
    to: string,
    options?: ISince,
  ): IPostedMessage[] {
    return this.callsWith(token, 'chat.postMessage', options)
      .filter(({ params }) => params.channel === to)
      .map(({ params, result }) => ({
        ...params,
        to: params.channel,
        channel: result!.channel,
        ts: result!.ts,
      }));
  }

  public ephemeralMessages(token: string, to: string, options?: ISince) {
    return this.callsWith(token, 'chat.postEphemeral', options)
      .filter(({ params }) => params.userId === to)
      .map(({ params }) => params as { text?: string; blocks?: unknown[] });
  }

  // The versions a posted message was updated to, oldest first.
  public messageUpdates(token: string, message: IPostedMessage) {
    return this.callsWith(token, 'chat.update')
      .filter(
        ({ params }) =>
          params.channel === message.channel && params.ts === message.ts,
      )
      .map(({ params }) => params as { text?: string; blocks?: unknown[] });
  }

  // --- SlackApiClient -------------------------------------------------------

  public async postEphemeral({ accessToken, ...params }) {
    this.refuseInvalid('chat.postEphemeral', messageProblems(params));
    this.record('chat.postEphemeral', params, accessToken);
  }

  public async postMessage({ accessToken, ...params }) {
    this.refuseInvalid('chat.postMessage', messageProblems(params));
    // Like Slack: a message to a user ID goes to the DM channel with them.
    const channel = params.channel.startsWith('U')
      ? `D${params.channel.slice(1)}`
      : params.channel;
    const result = { ok: true, channel, ts: this.nextTs() };

    this.record('chat.postMessage', params, accessToken, result);

    return result;
  }

  public async updateMessage({ accessToken, ...params }) {
    this.refuseInvalid('chat.update', messageProblems(params));
    this.record('chat.update', params, accessToken);

    return { ok: true, channel: params.channel, ts: params.ts };
  }

  public async openView(
    args: ViewsOpenArguments,
    accessToken: string,
  ): Promise<SlackResponse> {
    this.refuseInvalid('views.open', viewProblems(args.view));
    this.record('views.open', args, accessToken);

    return { ok: true, view: { id: this.nextViewId(), ...args.view } };
  }

  public async publishView(
    args: ViewsPublishArguments,
    accessToken: string,
  ): Promise<SlackResponse> {
    this.refuseInvalid('views.publish', viewProblems(args.view));
    this.record('views.publish', args, accessToken);

    return { ok: true, view: { id: this.nextViewId(), ...args.view } };
  }

  public async getFileInfo(fileId: string, accessToken: string) {
    this.record('files.info', { file: fileId }, accessToken);

    const file = this.files.get(fileId);

    if (!file) {
      throw new Error('file_not_found');
    }

    // The app downloads `url_private_download` with fetch(); a data: URL lets
    // it do that without a server.
    const content = Buffer.from(file.content).toString('base64');

    return {
      id: fileId,
      name: file.name,
      url_private_download: `data:text/csv;base64,${content}`,
    };
  }

  public async makeCall<ResponseData>(
    method: string,
    params: Record<string, unknown>,
    accessToken?: string,
  ): Promise<SlackResponse> {
    this.record(method, params, accessToken);

    switch (method) {
      case 'oauth.v2.access':
        return this.oauthAccess(params) as ResponseData;
      case 'users.info':
        return this.usersInfo(params.user as string) as ResponseData;
      case 'users.list':
        return this.usersList(accessToken) as ResponseData;
      default:
        throw new Error(`FakeSlackApiClient does not implement ${method}`);
    }
  }

  // --- fake Slack -----------------------------------------------------------

  // Like Slack: a view or message it would not accept fails the call (the
  // test fails too, see slack-violations.ts).
  private refuseInvalid(method: string, problems: string[]) {
    if (problems.length) {
      reportSlackViolation(method, problems);

      throw new Error(`An API error occurred: invalid_arguments (${method})`);
    }
  }

  private oauthAccess(params: Record<string, unknown>) {
    const grant = this.oauthGrants.get(params.code as string);

    if (!grant) {
      throw new Error('invalid_code');
    }

    return {
      ok: true,
      access_token: grant.botToken,
      team: { id: grant.teamId, name: grant.teamName },
      authed_user: {
        id: grant.installerId,
        access_token: 'xoxp-installer',
        scope: '',
        token_type: 'user',
      },
    };
  }

  private usersInfo(userId: string) {
    const user = this.users.get(userId);

    if (!user) {
      throw new Error('user_not_found');
    }

    return { ok: true, user: this.toSlackMember(user) };
  }

  // The app only knows the workspace by its bot token, so the fake maps the
  // token back to the workspace through the OAuth grant that issued it.
  private usersList(accessToken?: string) {
    const grant = [...this.oauthGrants.values()].find(
      ({ botToken }) => botToken === accessToken,
    );
    const members = [...this.users.values()]
      .filter((user) => user.teamId === grant?.teamId)
      .map((user) => this.toSlackMember(user));

    return { ok: true, members, response_metadata: { next_cursor: '' } };
  }

  private toSlackMember(user: IFakeSlackUser) {
    return {
      id: user.id,
      team_id: user.teamId,
      name: user.name,
      real_name: user.name,
      is_admin: !!user.isAdmin,
      is_bot: !!user.isBot,
      deleted: !!user.deleted,
      profile: { email: user.email, real_name: user.name },
    };
  }

  private record(
    method: string,
    params: object,
    token?: string,
    result?: SlackJson,
  ) {
    this.calls.push({ method, params: { ...params }, token, result });
  }

  private nextTs() {
    this.messageCount += 1;

    return `${Math.floor(Date.now() / 1000)}.${String(this.messageCount).padStart(6, '0')}`;
  }

  private nextViewId() {
    return `V${randomUUID().slice(0, 10).toUpperCase()}`;
  }
}
