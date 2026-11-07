import { Injectable } from '@nestjs/common';
import { WebAPICallResult, WebClient } from '@slack/web-api';
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
    const client = this.getClient(accessToken);

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

  private getClient(token?: string) {
    return new WebClient(token);
  }
}
