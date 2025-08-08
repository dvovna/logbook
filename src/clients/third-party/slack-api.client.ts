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
  accessToken: string;
  blocks?: KnownBlock[];
}

@Injectable()
export default class SlackApiClient {
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
