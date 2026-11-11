import SlackApiClient, {
  IShareFileParams,
  IUploadFileParams,
  slackErrorOf,
} from 'src/api-clients/third-party/slack-api.client';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import { Injectable, Logger } from '@nestjs/common';
import { SlackMessagePayloadInterface } from '@modules/slack-communication/types/slack-message-payload.interface';
import { WebAPICallResult } from '@slack/web-api';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { View } from '@slack/types/dist/views';

@Injectable()
export default class SlackCommunicationService {
  private readonly logger = new Logger(SlackCommunicationService.name);

  public constructor(
    private readonly slackApiClient: SlackApiClient,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  public async postEphemeral(
    channel: string,
    payload: SlackMessagePayloadInterface,
    teamId: string,
    userId?: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    await this.slackApiClient.postEphemeral({
      channel,
      accessToken,
      ...payload,
      userId: userId || channel,
    });
  }

  public async postMessage(
    channel: string,
    payload: SlackMessagePayloadInterface,
    teamId: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return await this.slackApiClient.postMessage({
      channel,
      accessToken,
      ...payload,
    });
  }

  public async updateMessage(
    channel: string,
    ts: string,
    payload: SlackMessagePayloadInterface,
    teamId: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return await this.slackApiClient.updateMessage({
      channel,
      ts,
      accessToken,
      ...payload,
    });
  }

  public async deleteMessage(channel: string, ts: string, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    await this.slackApiClient.deleteMessage({ channel, ts, accessToken });
  }

  public async openView(triggerId: string, view: View, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.openView(
      {
        trigger_id: triggerId,
        view,
      },
      accessToken,
    );
  }

  // A modal the user has open, by the view ID its interaction carries.
  // With `hash` (the interaction's view.hash), Slack refuses the update
  // (hash_conflict) when the view changed since that interaction: after two
  // quick clicks the later one's view may be up first, and the older one must
  // not replace it. That is skipped with a warning (false), not an error.
  public async updateView(
    viewId: string,
    view: View,
    teamId: string,
    hash?: string,
  ): Promise<boolean> {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    try {
      await this.slackApiClient.updateView(
        { view_id: viewId, view, ...(hash ? { hash } : {}) },
        accessToken,
      );

      return true;
    } catch (error) {
      if (slackErrorOf(error) !== 'hash_conflict') {
        throw error;
      }

      this.logger.warn(`View ${viewId} changed since the click: not updated`);

      return false;
    }
  }

  public async publishView(view: ViewsPublishArguments, slackTeamId: string) {
    const accessToken =
      await this.accessTokenService.getAccessToken(slackTeamId);

    return this.slackApiClient.publishView(view, accessToken);
  }

  public async makeCall<T extends WebAPICallResult>(
    method: string,
    params: Record<string, unknown>,
    teamId: string,
  ): Promise<T> {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.makeCall<T>(method, params, accessToken);
  }

  // Uploads a file to Slack, shared nowhere yet; returns its ID for
  // shareFile().
  public async uploadFile(
    params: Omit<IUploadFileParams, 'accessToken'>,
    teamId: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.uploadFile({ ...params, accessToken });
  }

  // Shares an uploaded file in a conversation (a D… channel for a DM: post
  // to the user first, and take the channel from the answer).
  public async shareFile(
    params: Omit<IShareFileParams, 'accessToken'>,
    teamId: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.shareFile({ ...params, accessToken });
  }

  public async getFileInfo(fileId: string, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.getFileInfo(fileId, accessToken);
  }

  public async fetchFileBytes(
    fileUrl: string,
    teamId: string,
    maxBytes: number,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.downloadFileBytes(
      fileUrl,
      accessToken,
      maxBytes,
    );
  }

  public async fetchFileContent(
    fileUrl: string,
    teamId: string,
    maxBytes: number,
  ) {
    // TextDecoder drops a leading byte order mark, as Response.text() did.
    return new TextDecoder('utf-8').decode(
      await this.fetchFileBytes(fileUrl, teamId, maxBytes),
    );
  }
}
