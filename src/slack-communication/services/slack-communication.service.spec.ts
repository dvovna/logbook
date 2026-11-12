import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import AccessTokenService from 'src/slack-communication/services/slack-access-token.service';

describe('SlackCommunicationService with a token Slack refuses', () => {
  const refused = (error = 'token_revoked') =>
    Object.assign(new Error(`An API error occurred: ${error}`), {
      data: { ok: false, error },
    });
  let slackApiClient: { postMessage: jest.Mock; openView: jest.Mock };
  let accessTokenService: {
    getAccessToken: jest.Mock;
    reload: jest.Mock;
    forgetRefused: jest.Mock;
  };
  let service: SlackCommunicationService;

  beforeEach(() => {
    slackApiClient = {
      postMessage: jest.fn(async ({ accessToken }) => {
        if (accessToken === 'xoxb-revoked') {
          throw refused();
        }

        return { ok: true };
      }),
      openView: jest.fn().mockRejectedValue(refused('invalid_auth')),
    };
    accessTokenService = {
      getAccessToken: jest.fn().mockResolvedValue('xoxb-revoked'),
      reload: jest.fn().mockResolvedValue('xoxb-stored'),
      forgetRefused: jest.fn(),
    };
    service = new SlackCommunicationService(
      slackApiClient as unknown as SlackApiClient,
      accessTokenService as unknown as AccessTokenService,
    );
  });

  it('sends again with the token stored now', async () => {
    await expect(
      service.postMessage('U1', { text: 'Hi' }, 'T1'),
    ).resolves.toEqual({ ok: true });

    expect(accessTokenService.reload).toHaveBeenCalledWith(
      'T1',
      'xoxb-revoked',
    );
    expect(
      slackApiClient.postMessage.mock.calls.map(
        ([{ accessToken }]) => accessToken,
      ),
    ).toEqual(['xoxb-revoked', 'xoxb-stored']);
  });

  it('fails without a second call when the stored token is the refused one', async () => {
    accessTokenService.reload.mockResolvedValue('xoxb-revoked');

    await expect(
      service.postMessage('U1', { text: 'Hi' }, 'T1'),
    ).rejects.toThrow('token_revoked');
    expect(slackApiClient.postMessage).toHaveBeenCalledTimes(1);
  });

  it('leaves any other failure as it is', async () => {
    slackApiClient.postMessage.mockRejectedValue(refused('channel_not_found'));

    await expect(
      service.postMessage('U1', { text: 'Hi' }, 'T1'),
    ).rejects.toThrow('channel_not_found');
    expect(accessTokenService.reload).not.toHaveBeenCalled();
  });

  // Its trigger_id would be gone by the second try.
  it('opens a view once, and drops the refused token for the next click', async () => {
    await expect(
      service.openView('trigger', { type: 'modal' } as never, 'T1'),
    ).rejects.toThrow('invalid_auth');

    expect(slackApiClient.openView).toHaveBeenCalledTimes(1);
    expect(accessTokenService.forgetRefused).toHaveBeenCalledWith(
      'T1',
      'xoxb-revoked',
    );
    expect(accessTokenService.reload).not.toHaveBeenCalled();
  });
});
