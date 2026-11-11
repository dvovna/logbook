import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';

describe('SlackCommunicationService.fetchFileContent', () => {
  it('decodes UTF-8 and drops a leading byte order mark', async () => {
    const slackApiClient = {
      downloadFileBytes: jest
        .fn()
        .mockResolvedValue(Buffer.from('﻿email;team_name\nä@x.test;Ö')),
    };
    const accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('xoxb-1'),
    };
    const service = new SlackCommunicationService(
      slackApiClient as unknown as SlackApiClient,
      accessTokenService as unknown as AccessTokenService,
    );

    expect(await service.fetchFileContent('https://url', 'T1', 100)).toBe(
      'email;team_name\nä@x.test;Ö',
    );
    expect(slackApiClient.downloadFileBytes).toHaveBeenCalledWith(
      'https://url',
      'xoxb-1',
      100,
    );
  });
});
