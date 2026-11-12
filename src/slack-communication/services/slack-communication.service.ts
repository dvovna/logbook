import SlackApiClient, {
  isRefusedTokenError,
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
    await this.withToken(teamId, (accessToken) =>
      this.slackApiClient.postEphemeral({
        channel,
        accessToken,
        ...payload,
        userId: userId || channel,
      }),
    );
  }

  public async postMessage(
    channel: string,
    payload: SlackMessagePayloadInterface,
    teamId: string,
  ) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.postMessage({
        channel,
        accessToken,
        ...payload,
      }),
    );
  }

  public async updateMessage(
    channel: string,
    ts: string,
    payload: SlackMessagePayloadInterface,
    teamId: string,
  ) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.updateMessage({
        channel,
        ts,
        accessToken,
        ...payload,
      }),
    );
  }

  public async deleteMessage(channel: string, ts: string, teamId: string) {
    await this.withToken(teamId, (accessToken) =>
      this.slackApiClient.deleteMessage({ channel, ts, accessToken }),
    );
  }

  // Not tried again with the token stored now when Slack refuses the cached
  // one: the trigger_id would be gone. The refused token is dropped, so the
  // next click reads the stored one.
  public async openView(triggerId: string, view: View, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    try {
      return await this.slackApiClient.openView(
        {
          trigger_id: triggerId,
          view,
        },
        accessToken,
      );
    } catch (error) {
      if (isRefusedTokenError(error)) {
        await this.accessTokenService.forgetRefused(teamId, accessToken);
      }

      throw error;
    }
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
    try {
      await this.withToken(teamId, (accessToken) =>
        this.slackApiClient.updateView(
          { view_id: viewId, view, ...(hash ? { hash } : {}) },
          accessToken,
        ),
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
    return this.withToken(slackTeamId, (accessToken) =>
      this.slackApiClient.publishView(view, accessToken),
    );
  }

  public async makeCall<T extends WebAPICallResult>(
    method: string,
    params: Record<string, unknown>,
    teamId: string,
  ): Promise<T> {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.makeCall<T>(method, params, accessToken),
    );
  }

  // Uploads a file to Slack, shared nowhere yet; returns its ID for
  // shareFile().
  public async uploadFile(
    params: Omit<IUploadFileParams, 'accessToken'>,
    teamId: string,
  ) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.uploadFile({ ...params, accessToken }),
    );
  }

  // Shares an uploaded file in a conversation (a D… channel for a DM: post
  // to the user first, and take the channel from the answer).
  public async shareFile(
    params: Omit<IShareFileParams, 'accessToken'>,
    teamId: string,
  ) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.shareFile({ ...params, accessToken }),
    );
  }

  public async getFileInfo(fileId: string, teamId: string) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.getFileInfo(fileId, accessToken),
    );
  }

  public async fetchFileBytes(
    fileUrl: string,
    teamId: string,
    maxBytes: number,
  ) {
    return this.withToken(teamId, (accessToken) =>
      this.slackApiClient.downloadFileBytes(fileUrl, accessToken, maxBytes),
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

  // `call` with the workspace's token. When Slack refuses a cached token, a
  // reinstall or an uninstall in another process (a deploy runs two for a
  // while) revoked it, and that process's forget() cleared only its own
  // cache: the call is made once more with the token stored now, unless
  // that is the refused one again. A refused call did nothing in Slack.
  private async withToken<T>(
    teamId: string,
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    try {
      return await call(accessToken);
    } catch (error) {
      if (!isRefusedTokenError(error)) {
        throw error;
      }

      const stored = await this.accessTokenService.reload(teamId, accessToken);

      if (stored === accessToken) {
        throw error;
      }

      return call(stored);
    }
  }
}
