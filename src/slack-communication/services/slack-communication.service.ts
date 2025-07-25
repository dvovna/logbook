import SlackApiClient from 'src/clients/third-party/slack-api.client';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';
import { Injectable } from '@nestjs/common';
import { SlackMessagePayload } from 'src/slack/types/SlackMessagePayload';
import { WebAPICallResult } from '@slack/web-api';

@Injectable()
export default class SlackCommunicationService {
  public constructor(
    private readonly slackApiClient: SlackApiClient,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  public async postMessage(
    channel: string,
    payload: SlackMessagePayload,
    teamId: string,
  ) {
    const accessToken = await this.accessTokenService.getAccessToken(teamId);

    await this.slackApiClient.postMessage({
      channel,
      accessToken,
      ...payload,
    });
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
