import SlackApiClient from 'src/clients/third-party/slack-api.client';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import { Injectable } from '@nestjs/common';
import { SlackMessagePayloadInterface } from 'src/slack/types/slack-message-payload.interface';
import { WebAPICallResult } from '@slack/web-api';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { View } from '@slack/types/dist/views';

@Injectable()
export default class SlackCommunicationService {
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

  public async getFileInfo(fileId: string, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    return this.slackApiClient.getFileInfo(fileId, accessToken);
  }

  public async fetchFileContent(fileUrl: string, teamId: string) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    const response = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return response.text();
  }
}
