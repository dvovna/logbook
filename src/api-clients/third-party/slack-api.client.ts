import { Injectable } from '@nestjs/common';
import { WebAPICallResult, WebClient, WebClientOptions } from '@slack/web-api';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import {
  ViewsOpenArguments,
  ViewsPublishArguments,
  ViewsUpdateArguments,
} from '@slack/web-api/dist/types/request/views';
import { SlackRateLimits } from 'src/api-clients/third-party/slack-rate-limits';

interface ISendMessageParams {
  channel: string;
  text?: string;
  blocks?: KnownBlock[];
  accessToken: string;
}

interface ISendEphemeralMessageParams extends ISendMessageParams {
  userId: string;
}

export interface IUploadFileParams {
  filename: string;
  content: string;
  accessToken: string;
}

export interface IShareFileParams {
  // What uploadFile() returned.
  fileId: string;
  // A conversation ID: C…, G…, or D… for a DM (a user ID is refused).
  channelId: string;
  title: string;
  accessToken: string;
}

// views.open has to reach Slack while its trigger_id lives (3 seconds): one
// try, and a rate limit fails it at once instead of being waited out.
export const INTERACTIVE_CALL_OPTIONS: WebClientOptions = {
  retryConfig: { retries: 0 },
  rejectRateLimitedCalls: true,
  timeout: 2_500,
};

// The other calls mostly run after Slack got its answer: a few quick
// retries instead of the library's ten over about half an hour. A rate limit
// is waited out by SlackRateLimits, which pauses only the method Slack
// limited.
export const CALL_OPTIONS: WebClientOptions = {
  retryConfig: { retries: 3, factor: 2, minTimeout: 500, maxTimeout: 4_000 },
  rejectRateLimitedCalls: true,
  timeout: 10_000,
};

// The clients of a token unused this long are dropped: with token rotation
// every workspace gets a new token every 12 hours, and the old one is never
// used again.
export const IDLE_CLIENT_MS = 60 * 60_000;
const SWEEP_EVERY_MS = 10 * 60_000;

// Where Slack serves files from and takes uploads (GovSlack has its own
// domain).
const SLACK_FILE_HOSTS = ['files.slack.com', 'files.slack-gov.com'];

// Sending a file's bytes to its upload URL: as long as other calls, and a
// second more per full megabyte (a year's CSV of a big workspace is tens of
// megabytes), up to a minute.
const UPLOAD_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_PER_MB_MS = 1_000;
const MAX_UPLOAD_TIMEOUT_MS = 60_000;

export const uploadTimeoutMs = (bytes: number) =>
  Math.min(
    UPLOAD_TIMEOUT_MS +
      Math.floor(bytes / 1024 ** 2) * UPLOAD_TIMEOUT_PER_MB_MS,
    MAX_UPLOAD_TIMEOUT_MS,
  );

const isSlackFileUrl = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);

    return protocol === 'https:' && SLACK_FILE_HOSTS.includes(hostname);
  } catch {
    return false;
  }
};

// The error code of a failed Slack call ("missing_scope", "not_in_channel"),
// as @slack/web-api reports it; undefined for any other failure.
export const slackErrorOf = (error: unknown): string | undefined =>
  (error as { data?: { error?: string } } | null)?.data?.error;

@Injectable()
export default class SlackApiClient {
  // One client per workspace token and kind of call, reused across calls.
  private readonly clients = new Map<
    string,
    { client: WebClient; lastUsedAt: number }
  >();

  private lastSweepAt = performance.now();

  private readonly rateLimits = new SlackRateLimits();

  public async postEphemeral({
    channel,
    text,
    userId,
    blocks = [],
    accessToken,
  }: ISendEphemeralMessageParams) {
    const result = await this.send(
      'chat.postEphemeral',
      accessToken,
      (client) =>
        client.chat.postEphemeral({ channel, user: userId, text, blocks }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to send message');
    }
  }

  public async postMessage({
    channel,
    text,
    blocks = [],
    accessToken,
  }: ISendMessageParams) {
    const result = await this.send('chat.postMessage', accessToken, (client) =>
      client.chat.postMessage({ channel, text, blocks }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to send message');
    }

    return result;
  }

  public async updateMessage({
    channel,
    ts,
    text,
    blocks = [],
    accessToken,
  }: ISendMessageParams & { ts: string }) {
    const result = await this.send('chat.update', accessToken, (client) =>
      client.chat.update({ channel, ts, text, blocks }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to update message');
    }

    return result;
  }

  public async deleteMessage({
    channel,
    ts,
    accessToken,
  }: {
    channel: string;
    ts: string;
    accessToken: string;
  }) {
    const result = await this.send('chat.delete', accessToken, (client) =>
      client.chat.delete({ channel, ts }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to delete message');
    }
  }

  public async openView(viewOpenArgs: ViewsOpenArguments, accessToken: string) {
    const client = this.getClient(accessToken, { interactive: true });

    const result = await client.views.open(viewOpenArgs);

    if (!result.ok) {
      throw new Error(result.error || 'Failed to open view');
    }

    return result;
  }

  // Replaces an open modal, e.g. a form whose fields a choice in it filled.
  public async updateView(
    viewUpdateArguments: ViewsUpdateArguments,
    accessToken: string,
  ) {
    const result = await this.send('views.update', accessToken, (client) =>
      client.views.update(viewUpdateArguments),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to update view');
    }

    return result;
  }

  public async publishView(
    viewPublishArguments: ViewsPublishArguments,
    accessToken: string,
  ) {
    const result = await this.send('views.publish', accessToken, (client) =>
      client.views.publish(viewPublishArguments),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to publish view');
    }

    return result;
  }

  public async getFileInfo(fileId: string, accessToken: string) {
    const result = await this.send('files.info', accessToken, (client) =>
      client.files.info({ file: fileId }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch file info');
    }

    return result.file;
  }

  // Downloads a file Slack hosts (files.info's url_private_download). The URL
  // comes from Slack, but the bot token goes with the request, so it is sent
  // only to Slack's file hosts, and the file is read only up to `maxBytes`.
  public async downloadFileBytes(
    url: string,
    accessToken: string,
    maxBytes: number,
  ): Promise<Buffer> {
    if (!isSlackFileUrl(url)) {
      throw new Error(`Refusing to download a file from ${url}`);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download the file: ${response.status}`);
    }

    const content = Buffer.from(await response.arrayBuffer());

    if (content.byteLength > maxBytes) {
      throw new Error(`The file is larger than ${maxBytes} bytes`);
    }

    return content;
  }

  // The first two of Slack's three steps to share a file: get an upload URL,
  // send the bytes there. Returns the file's ID, for shareFile(); until then
  // the file is in no conversation. Needs the files:write scope.
  public async uploadFile({
    filename,
    content,
    accessToken,
  }: IUploadFileParams): Promise<string> {
    const bytes = Buffer.from(content);

    const { upload_url: uploadUrl, file_id: fileId } = await this.send(
      'files.getUploadURLExternal',
      accessToken,
      (client) =>
        client.files.getUploadURLExternal({
          filename,
          length: bytes.byteLength,
        }),
    );

    // The URL comes from Slack, and only the file goes there.
    if (!uploadUrl || !fileId || !isSlackFileUrl(uploadUrl)) {
      throw new Error(`Refusing to upload a file to ${uploadUrl}`);
    }

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: bytes,
      signal: AbortSignal.timeout(uploadTimeoutMs(bytes.byteLength)),
    });

    if (!response.ok) {
      throw new Error(`Failed to upload the file: ${response.status}`);
    }

    return fileId;
  }

  // The third step: completes an upload into a conversation, where the file
  // shows. Needs the files:write scope.
  public async shareFile({
    fileId,
    channelId,
    title,
    accessToken,
  }: IShareFileParams) {
    const result = await this.send(
      'files.completeUploadExternal',
      accessToken,
      (client) =>
        client.files.completeUploadExternal({
          files: [{ id: fileId, title }],
          channel_id: channelId,
        }),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Failed to share the file');
    }

    return result;
  }

  public async makeCall<ResponseData>(
    method: string,
    params: Record<string, unknown>,
    accessToken?: string,
  ) {
    const result: WebAPICallResult & { error?: string } = await this.send(
      method,
      accessToken,
      (client) => client.apiCall(method, params),
    );

    if (!result.ok) {
      throw new Error(result.error || 'Slack API call failed');
    }

    return result as ResponseData & WebAPICallResult;
  }

  // `method` with the token's client, waiting out Slack's rate limits on it.
  private send<T>(
    method: string,
    token: string | undefined,
    call: (client: WebClient) => Promise<T>,
  ) {
    return this.rateLimits.call(method, token, () =>
      call(this.getClient(token)),
    );
  }

  private getClient(token?: string, { interactive = false } = {}) {
    const now = performance.now();
    const key = `${interactive ? 'interactive' : 'other'}:${token ?? ''}`;

    this.dropIdleClients(now);

    let entry = this.clients.get(key);

    if (!entry) {
      entry = {
        client: new WebClient(
          token,
          interactive ? INTERACTIVE_CALL_OPTIONS : CALL_OPTIONS,
        ),
        lastUsedAt: now,
      };
      this.clients.set(key, entry);
    }

    entry.lastUsedAt = now;

    return entry.client;
  }

  private dropIdleClients(now: number) {
    if (now - this.lastSweepAt < SWEEP_EVERY_MS) {
      return;
    }

    this.lastSweepAt = now;

    for (const [key, { lastUsedAt }] of this.clients) {
      if (now - lastUsedAt > IDLE_CLIENT_MS) {
        this.clients.delete(key);
      }
    }
  }
}
