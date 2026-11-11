import { randomUUID } from 'crypto';
import { View } from '@slack/types/dist/views';
import { WebAPIRateLimitedError } from '@slack/web-api';
import {
  ViewsOpenArguments,
  ViewsPublishArguments,
  ViewsUpdateArguments,
} from '@slack/web-api/dist/types/request/views';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { SlackRateLimits } from 'src/api-clients/third-party/slack-rate-limits';
import { SlackJson } from './block-kit';
import {
  completeUploadProblems,
  messageProblems,
  uploadUrlProblems,
  viewProblems,
} from './block-kit-rules';
import {
  messageDisplayProblems,
  viewDisplayProblems,
} from './block-kit-display-rules';
import {
  reportDisplayProblems,
  reportSlackViolation,
} from './slack-violations';

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
  // Token rotation: the bot token expires after `expiresIn` seconds, and
  // the refresh token gets the next pair (oauth.v2.access with
  // grant_type=refresh_token).
  refreshToken?: string;
  expiresIn?: number;
}

// A file the app shared (files.completeUploadExternal), with the bytes it
// sent to the upload URL.
export interface IUploadedFile {
  channel: string;
  filename: string;
  title?: string;
  content: string;
}

// Calls a test can make fail (failNext).
type FailingMethod =
  | 'chat.postMessage'
  | 'chat.update'
  | 'files.getUploadURLExternal'
  | 'files.completeUploadExternal';

type PublicMethods<T> = Pick<T, keyof T>;

// Slack's Retry-After when the fake answers `ratelimited`.
export const FAKE_RETRY_AFTER_SECONDS = 1;

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
  private readonly files = new Map<
    string,
    { name: string; content: string | Buffer; size: number }
  >();
  private readonly oauthGrants = new Map<string, IFakeOauthGrant>();
  private readonly failures = new Map<
    string,
    { times: number; error: string; channel?: string }
  >();
  // Files uploaded but not necessarily shared yet, by file ID.
  private readonly uploads = new Map<
    string,
    { filename: string; content: string }
  >();
  private messageCount = 0;
  // The version of each open modal, by view ID, as Slack keeps it.
  private readonly viewHashes = new Map<string, string>();
  // A rate limit is waited out as SlackApiClient waits it out, per method
  // and token.
  private readonly rateLimits = new SlackRateLimits();

  // --- test setup -----------------------------------------------------------

  public addUser(user: IFakeSlackUser) {
    this.users.set(user.id, user);
  }

  // `size` is what files.info reports, e.g. to fake a large file.
  public addFile(
    name: string,
    content: string | Buffer,
    { size = Buffer.byteLength(content) }: { size?: number } = {},
  ) {
    const id = `F${randomUUID().slice(0, 8).toUpperCase()}`;
    this.files.set(id, { name, content, size });

    return id;
  }

  public addOauthGrant(code: string, grant: IFakeOauthGrant) {
    this.oauthGrants.set(code, grant);
  }

  // --- assertions -----------------------------------------------------------

  // The next `times` calls of `method` fail as when Slack is down, or with
  // `error` (e.g. missing_scope); they are not recorded. With `ratelimited`
  // Slack asks to wait FAKE_RETRY_AFTER_SECONDS: the call waits, with the
  // other calls of the method in the workspace, and tries again, as the real
  // client does (SlackRateLimits).
  public failNext(
    method: FailingMethod,
    times = 1,
    error = 'service_unavailable',
  ) {
    this.failures.set(method, { times, error });
  }

  // How many of the failures failNext() asked for are still to come.
  public failuresLeft(method: FailingMethod) {
    return this.failures.get(method)?.times ?? 0;
  }

  // As failNext, for the messages to one channel or user only: an action
  // often sends several messages at once, in no fixed order.
  public failNextTo(
    channel: string,
    method: FailingMethod = 'chat.postMessage',
    times = 1,
    error = 'service_unavailable',
  ) {
    this.failures.set(method, { times, error, channel });
  }

  // The current position in the call log, for `since`.
  public mark() {
    return this.calls.length;
  }

  public callsWith(
    token: string | undefined,
    method?: string,
    { since = 0 }: ISince = {},
  ) {
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

  // The modal last opened in the workspace, with the ID Slack gave it (an
  // interaction in it carries the ID).
  public openedModal(token: string, options?: ISince): View {
    const open = this.callsWith(token, 'views.open', options).pop();

    if (!open) {
      throw new Error('No modal was opened');
    }

    return {
      ...open.params.view,
      id: open.result?.view?.id,
      hash: open.result?.view?.hash,
    };
  }

  // The modal the app last replaced with views.update, with its ID.
  public updatedModal(token: string, options?: ISince): View {
    const update = this.callsWith(token, 'views.update', options).pop();

    if (!update) {
      throw new Error('No modal was updated');
    }

    return {
      ...update.params.view,
      id: update.params.view_id,
      hash: update.result?.view?.hash,
    };
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

  // postedMessages() without the ones the app deleted (chat.delete).
  public shownMessages(
    token: string,
    to: string,
    options?: ISince,
  ): IPostedMessage[] {
    const deleted = new Set(
      this.callsWith(token, 'chat.delete').map(
        ({ params }) => `${params.channel}/${params.ts}`,
      ),
    );

    return this.postedMessages(token, to, options).filter(
      ({ channel, ts }) => !deleted.has(`${channel}/${ts}`),
    );
  }

  // The files the app shared in `channel` (a DM's is D…, see postMessage).
  public uploadedFiles(
    token: string,
    channel: string,
    options?: ISince,
  ): IUploadedFile[] {
    return this.callsWith(token, 'files.completeUploadExternal', options)
      .filter(({ params }) => params.channel_id === channel)
      .flatMap(({ params }) =>
        params.files.map(({ id, title }: { id: string; title?: string }) => ({
          channel,
          title,
          ...this.uploads.get(id)!,
        })),
      );
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

  public postEphemeral({ accessToken, ...params }) {
    return this.rateLimits.call('chat.postEphemeral', accessToken, async () => {
      this.refuseInvalid('chat.postEphemeral', messageProblems(params));
      reportDisplayProblems(
        'chat.postEphemeral',
        messageDisplayProblems(params),
      );
      this.record('chat.postEphemeral', params, accessToken);
    });
  }

  public postMessage({ accessToken, ...params }) {
    return this.rateLimits.call('chat.postMessage', accessToken, async () => {
      this.failIfAsked('chat.postMessage', params.channel);
      this.refuseInvalid('chat.postMessage', messageProblems(params));
      reportDisplayProblems('chat.postMessage', messageDisplayProblems(params));
      // Like Slack: a message to a user ID goes to the DM channel with them.
      const channel = params.channel.startsWith('U')
        ? `D${params.channel.slice(1)}`
        : params.channel;
      const result = { ok: true, channel, ts: this.nextTs() };

      this.record('chat.postMessage', params, accessToken, result);

      return result;
    });
  }

  public updateMessage({ accessToken, ...params }) {
    return this.rateLimits.call('chat.update', accessToken, async () => {
      this.failIfAsked('chat.update', params.channel);
      this.refuseInvalid('chat.update', messageProblems(params));
      reportDisplayProblems('chat.update', messageDisplayProblems(params));
      this.record('chat.update', params, accessToken);

      return { ok: true, channel: params.channel, ts: params.ts };
    });
  }

  // Like Slack, it needs the conversation (D… for a DM, as postMessage
  // answered) and a message the app posted there.
  public deleteMessage({
    accessToken,
    channel,
    ts,
  }: Parameters<SlackApiClient['deleteMessage']>[0]) {
    return this.rateLimits.call('chat.delete', accessToken, async () => {
      const posted = this.callsWith(accessToken, 'chat.postMessage').some(
        ({ result }) => result?.channel === channel && result?.ts === ts,
      );

      this.refuseInvalid(
        'chat.delete',
        posted ? [] : [`no message ${ts} in ${channel}`],
      );
      this.record('chat.delete', { channel, ts }, accessToken);
    });
  }

  public async openView(
    args: ViewsOpenArguments,
    accessToken: string,
  ): Promise<SlackResponse> {
    this.refuseInvalid('views.open', viewProblems(args.view));
    reportDisplayProblems(
      `views.open ${args.view.callback_id ?? ''}`,
      viewDisplayProblems(args.view),
    );
    const id = this.nextViewId();
    const hash = this.nextViewHash(id);
    const result = { ok: true, view: { id, hash, ...args.view } };

    this.record('views.open', args, accessToken, result);

    return result;
  }

  // Like Slack, it needs the ID of the open view (the interaction's
  // view.id), checks the view as views.open does, and refuses an update with
  // a `hash` that is no longer the view's (hash_conflict, not recorded).
  public updateView(
    args: ViewsUpdateArguments,
    accessToken: string,
  ): Promise<SlackResponse> {
    return this.rateLimits.call('views.update', accessToken, async () => {
      const { view_id: viewId, hash } = args as {
        view_id?: string;
        hash?: string;
      };

      if (hash && viewId && this.viewHashes.get(viewId) !== hash) {
        throw Object.assign(
          new Error('An API error occurred: hash_conflict (views.update)'),
          {
            code: 'slack_webapi_platform_error',
            data: { ok: false, error: 'hash_conflict' },
          },
        );
      }

      this.refuseInvalid('views.update', [
        ...(viewId ? [] : ['no view_id']),
        ...viewProblems(args.view),
      ]);
      reportDisplayProblems(
        `views.update ${args.view.callback_id ?? ''}`,
        viewDisplayProblems(args.view),
      );
      const result = {
        ok: true,
        view: {
          id: viewId,
          hash: viewId && this.nextViewHash(viewId),
          ...args.view,
        },
      };

      this.record('views.update', args, accessToken, result);

      return result;
    });
  }

  public publishView(
    args: ViewsPublishArguments,
    accessToken: string,
  ): Promise<SlackResponse> {
    return this.rateLimits.call('views.publish', accessToken, async () => {
      this.refuseInvalid('views.publish', viewProblems(args.view));
      reportDisplayProblems(
        `views.publish ${args.view.callback_id ?? ''}`,
        viewDisplayProblems(args.view),
      );
      this.record('views.publish', args, accessToken);

      return { ok: true, view: { id: this.nextViewId(), ...args.view } };
    });
  }

  public getFileInfo(fileId: string, accessToken: string) {
    return this.rateLimits.call('files.info', accessToken, async () => {
      this.record('files.info', { file: fileId }, accessToken);

      const file = this.files.get(fileId);

      if (!file) {
        throw new Error('file_not_found');
      }

      return {
        id: fileId,
        name: file.name,
        size: file.size,
        url_private_download: `https://files.slack.com/files-pri/T_TEST-${fileId}/download/${file.name}`,
      };
    });
  }

  public async downloadFileBytes(url: string, accessToken: string) {
    this.record('files.download', { url }, accessToken);

    const fileId = /-(F[0-9A-F]+)\//.exec(url)?.[1];
    const file = fileId && this.files.get(fileId);

    if (!file) {
      throw new Error(`No file at ${url}`);
    }

    return Buffer.from(file.content);
  }

  // Slack's first two steps: files.getUploadURLExternal, then the bytes to
  // the upload URL (kept here with the file). shareFile() is the third.
  public uploadFile({
    accessToken,
    filename,
    content,
  }: Parameters<SlackApiClient['uploadFile']>[0]): Promise<string> {
    const length = Buffer.byteLength(content);

    return this.rateLimits.call(
      'files.getUploadURLExternal',
      accessToken,
      async () => {
        this.failIfAsked('files.getUploadURLExternal');
        this.refuseInvalid(
          'files.getUploadURLExternal',
          uploadUrlProblems({ filename, length }),
        );

        const fileId = `F${randomUUID().slice(0, 8).toUpperCase()}`;

        this.record(
          'files.getUploadURLExternal',
          { filename, length },
          accessToken,
          {
            ok: true,
            upload_url: `https://files.slack.com/upload/v1/${fileId}`,
            file_id: fileId,
          },
        );
        this.uploads.set(fileId, { filename, content });

        return fileId;
      },
    );
  }

  // files.completeUploadExternal, into a conversation.
  public shareFile({
    accessToken,
    fileId,
    channelId,
    title,
  }: Parameters<SlackApiClient['shareFile']>[0]): Promise<SlackResponse> {
    return this.rateLimits.call(
      'files.completeUploadExternal',
      accessToken,
      async () => {
        const { filename } = this.uploads.get(fileId) ?? {};
        const params = {
          files: [{ id: fileId, title }],
          channel_id: channelId,
        };

        this.failIfAsked('files.completeUploadExternal');
        this.refuseInvalid(
          'files.completeUploadExternal',
          completeUploadProblems(params, new Set(this.uploads.keys())),
        );
        this.record('files.completeUploadExternal', params, accessToken);

        return { ok: true, files: [{ id: fileId, title, name: filename }] };
      },
    );
  }

  public makeCall<ResponseData>(
    method: string,
    params: Record<string, unknown>,
    accessToken?: string,
  ): Promise<SlackResponse> {
    return this.rateLimits.call(method, accessToken, async () => {
      this.record(method, params, accessToken);

      switch (method) {
        case 'oauth.v2.access':
          return this.oauthAccess(params) as ResponseData;
        case 'users.info':
          return this.usersInfo(params.user as string) as ResponseData;
        case 'users.list':
          return this.usersList(accessToken) as ResponseData;
        case 'auth.revoke':
          return { ok: true, revoked: true } as ResponseData;
        default:
          throw new Error(`FakeSlackApiClient does not implement ${method}`);
      }
    });
  }

  // --- fake Slack -----------------------------------------------------------

  // Thrown as @slack/web-api throws a platform error, with the code in
  // `data.error` (slackErrorOf), and Slack's rate limit (an HTTP 429 with
  // Retry-After) as it throws one with rejectRateLimitedCalls.
  private failIfAsked(method: string, channel?: string) {
    const failure = this.failures.get(method);

    if (
      failure &&
      failure.times > 0 &&
      (!failure.channel || failure.channel === channel)
    ) {
      this.failures.set(method, { ...failure, times: failure.times - 1 });

      if (failure.error === 'ratelimited') {
        throw new WebAPIRateLimitedError(FAKE_RETRY_AFTER_SECONDS);
      }

      throw Object.assign(
        new Error(`An API error occurred: ${failure.error} (${method})`),
        {
          code: 'slack_webapi_platform_error',
          data: { ok: false, error: failure.error },
        },
      );
    }
  }

  // Like Slack: a view or message it would not accept fails the call (the
  // test fails too, see slack-violations.ts).
  private refuseInvalid(method: string, problems: string[]) {
    if (problems.length) {
      reportSlackViolation(method, problems);

      throw new Error(`An API error occurred: invalid_arguments (${method})`);
    }
  }

  private oauthAccess(params: Record<string, unknown>) {
    if (params.grant_type === 'refresh_token') {
      return this.refreshToken(params.refresh_token as string);
    }

    const grant = this.oauthGrants.get(params.code as string);

    if (!grant) {
      throw new Error('invalid_code');
    }

    return {
      ok: true,
      access_token: grant.botToken,
      ...(grant.refreshToken
        ? { refresh_token: grant.refreshToken, expires_in: grant.expiresIn }
        : {}),
      team: { id: grant.teamId, name: grant.teamName },
      authed_user: {
        id: grant.installerId,
        access_token: 'xoxp-installer',
        scope: '',
        token_type: 'user',
      },
    };
  }

  // A new pair for a rotating token; the grant follows it, so the workspace
  // is still known by its new token.
  private refreshToken(refreshToken: string) {
    const grant = [...this.oauthGrants.values()].find(
      (candidate) => candidate.refreshToken === refreshToken,
    );

    if (!grant) {
      throw new Error('invalid_refresh_token');
    }

    grant.botToken = `${grant.botToken}-r`;
    grant.refreshToken = `${refreshToken}-r`;

    return {
      ok: true,
      token_type: 'bot',
      access_token: grant.botToken,
      refresh_token: grant.refreshToken,
      // A refreshed token lives 12 hours, as on Slack.
      expires_in: 43200,
      team: { id: grant.teamId, name: grant.teamName },
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

  private nextViewHash(viewId: string) {
    const hash = `${Date.now()}.${randomUUID().slice(0, 8)}`;

    this.viewHashes.set(viewId, hash);

    return hash;
  }

  private nextViewId() {
    return `V${randomUUID().slice(0, 10).toUpperCase()}`;
  }
}
