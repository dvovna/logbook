import { Injectable } from '@nestjs/common';
import { WebAPICallResult, WebClient, WebClientOptions } from '@slack/web-api';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import {
  ViewsOpenArguments,
  ViewsPublishArguments,
} from '@slack/web-api/dist/types/request/views';

interface ISendMessageParams {
  channel: string;
  text?: string;
  blocks?: KnownBlock[];
  accessToken: string;
}

interface ISendEphemeralMessageParams extends ISendMessageParams {
  userId: string;
}

// views.open has to reach Slack while its trigger_id lives (3 seconds): one
// try, and a rate limit fails it at once instead of being waited out.
export const INTERACTIVE_CALL_OPTIONS: WebClientOptions = {
  retryConfig: { retries: 0 },
  rejectRateLimitedCalls: true,
  timeout: 2_500,
};

// The other calls mostly run after Slack got its answer: a few quick
// retries instead of the library's ten over about half an hour.
export const CALL_OPTIONS: WebClientOptions = {
  retryConfig: { retries: 3, factor: 2, minTimeout: 500, maxTimeout: 4_000 },
  timeout: 10_000,
};

// Where Slack serves files from (GovSlack has its own domain).
const SLACK_FILE_HOSTS = ['files.slack.com', 'files.slack-gov.com'];

const isSlackFileUrl = (url: string) => {
  try {
    const { protocol, hostname } = new URL(url);

    return protocol === 'https:' && SLACK_FILE_HOSTS.includes(hostname);
  } catch {
    return false;
  }
};

@Injectable()
export default class SlackApiClient {
  // One client per workspace token and kind of call, reused across calls.
  private readonly clients = new Map<string, WebClient>();

  public async postEphemeral({
    channel,
    text,
    userId,
    blocks = [],
    accessToken,
  }: ISendEphemeralMessageParams) {
    const client = this.getClient(accessToken);

    const result = await client.chat.postEphemeral({
      channel,
      user: userId,
      text,
      blocks,
    });

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
    const client = this.getClient(accessToken);

    const result = await client.chat.postMessage({
      channel,
      text,
      blocks,
    });

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
    const client = this.getClient(accessToken);

    const result = await client.chat.update({
      channel,
      ts,
      text,
      blocks,
    });

    if (!result.ok) {
      throw new Error(result.error || 'Failed to update message');
    }

    return result;
  }

  public async openView(viewOpenArgs: ViewsOpenArguments, accessToken: string) {
    const client = this.getClient(accessToken, { interactive: true });

    const result = await client.views.open(viewOpenArgs);

    if (!result.ok) {
      throw new Error(result.error || 'Failed to open view');
    }

    return result;
  }

  public async publishView(
    viewPublishArguments: ViewsPublishArguments,
    accessToken: string,
  ) {
    const client = this.getClient(accessToken);

    const result = await client.views.publish(viewPublishArguments);

    if (!result.ok) {
      throw new Error(result.error || 'Failed to publish view');
    }

    return result;
  }

  public async getFileInfo(fileId: string, accessToken: string) {
    const client = this.getClient(accessToken);

    const result = await client.files.info({ file: fileId });

    if (!result.ok) {
      throw new Error(result.error || 'Failed to fetch file info');
    }

    return result.file;
  }

  // Downloads a file Slack hosts (files.info's url_private_download). The URL
  // comes from Slack, but the bot token goes with the request, so it is sent
  // only to Slack's file hosts, and the file is read only up to `maxBytes`.
  public async downloadFile(
    url: string,
    accessToken: string,
    maxBytes: number,
  ): Promise<string> {
    if (!isSlackFileUrl(url)) {
      throw new Error(`Refusing to download a file from ${url}`);
    }

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download the file: ${response.status}`);
    }

    const content = await response.text();

    if (Buffer.byteLength(content) > maxBytes) {
      throw new Error(`The file is larger than ${maxBytes} bytes`);
    }

    return content;
  }

  public async makeCall<ResponseData>(
    method: string,
    params: Record<string, unknown>,
    accessToken?: string,
  ) {
    const client = this.getClient(accessToken);

    const result = await client.apiCall(method, params);

    if (!result.ok) {
      throw new Error(result.error || 'Slack API call failed');
    }

    return result as ResponseData & WebAPICallResult;
  }

  private getClient(token?: string, { interactive = false } = {}) {
    const key = `${interactive ? 'interactive' : 'other'}:${token ?? ''}`;
    let client = this.clients.get(key);

    if (!client) {
      client = new WebClient(
        token,
        interactive ? INTERACTIVE_CALL_OPTIONS : CALL_OPTIONS,
      );
      this.clients.set(key, client);
    }

    return client;
  }
}
