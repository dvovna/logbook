import { WebClient } from '@slack/web-api';
import SlackApiClient, {
  CALL_OPTIONS,
  INTERACTIVE_CALL_OPTIONS,
} from 'src/api-clients/third-party/slack-api.client';

jest.mock('@slack/web-api', () => ({ WebClient: jest.fn() }));

// The integration tests replace this client with a fake, so what it sends to
// the Slack Web API is checked here: the method, the token and how the
// arguments are mapped.
describe('SlackApiClient', () => {
  const ok = { ok: true };
  let slack: {
    chat: Record<'postEphemeral' | 'postMessage' | 'update', jest.Mock>;
    views: Record<'open' | 'publish', jest.Mock>;
    files: Record<'info', jest.Mock>;
    apiCall: jest.Mock;
  };
  let client: SlackApiClient;

  beforeEach(() => {
    slack = {
      chat: {
        postEphemeral: jest.fn().mockResolvedValue(ok),
        postMessage: jest.fn().mockResolvedValue({ ...ok, ts: '1.0' }),
        update: jest.fn().mockResolvedValue(ok),
      },
      views: {
        open: jest.fn().mockResolvedValue(ok),
        publish: jest.fn().mockResolvedValue(ok),
      },
      files: {
        info: jest.fn().mockResolvedValue({ ...ok, file: { id: 'F1' } }),
      },
      apiCall: jest.fn().mockResolvedValue({ ...ok, members: [] }),
    };
    (WebClient as unknown as jest.Mock).mockReset().mockReturnValue(slack);
    client = new SlackApiClient();
  });

  it("calls Slack with the workspace's token", async () => {
    await client.postMessage({
      channel: 'U1',
      text: 'Hi',
      accessToken: 'xoxb-1',
    });
    await client.postMessage({
      channel: 'U1',
      text: 'Hi',
      accessToken: 'xoxb-2',
    });

    expect(WebClient).toHaveBeenNthCalledWith(1, 'xoxb-1', CALL_OPTIONS);
    expect(WebClient).toHaveBeenNthCalledWith(2, 'xoxb-2', CALL_OPTIONS);
  });

  it('reuses the client of a workspace', async () => {
    const home = { user_id: 'U1', view: { type: 'home' as const, blocks: [] } };

    await client.publishView(home, 'xoxb-1');
    await client.publishView(home, 'xoxb-1');
    await client.postMessage({
      channel: 'U1',
      text: 'Hi',
      accessToken: 'xoxb-1',
    });

    expect(WebClient).toHaveBeenCalledTimes(1);
  });

  // A modal has to open while its trigger_id lives, so views.open is not
  // retried and does not wait out a rate limit.
  it('opens views without retries and with a short timeout', async () => {
    await client.openView(
      {
        trigger_id: 't1',
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: 'Hi' },
          blocks: [],
        },
      },
      'xoxb-1',
    );

    expect(WebClient).toHaveBeenCalledWith('xoxb-1', INTERACTIVE_CALL_OPTIONS);
    expect(INTERACTIVE_CALL_OPTIONS).toMatchObject({
      retryConfig: { retries: 0 },
      rejectRateLimitedCalls: true,
    });
    expect(INTERACTIVE_CALL_OPTIONS.timeout).toBeLessThan(3_000);
  });

  it('posts an ephemeral message to the user in the channel', async () => {
    await client.postEphemeral({
      channel: 'C1',
      userId: 'U1',
      text: 'Only you can see this',
      accessToken: 'xoxb-1',
    });

    expect(slack.chat.postEphemeral).toHaveBeenCalledWith({
      channel: 'C1',
      user: 'U1',
      text: 'Only you can see this',
      blocks: [],
    });
  });

  it('posts, then updates a message and returns what Slack answered', async () => {
    const posted = await client.postMessage({
      channel: 'U1',
      text: 'Approve?',
      blocks: [{ type: 'divider' }],
      accessToken: 'xoxb-1',
    });
    await client.updateMessage({
      channel: 'D1',
      ts: '1.0',
      text: 'Approved',
      accessToken: 'xoxb-1',
    });

    expect(posted).toEqual({ ok: true, ts: '1.0' });
    expect(slack.chat.postMessage).toHaveBeenCalledWith({
      channel: 'U1',
      text: 'Approve?',
      blocks: [{ type: 'divider' }],
    });
    expect(slack.chat.update).toHaveBeenCalledWith({
      channel: 'D1',
      ts: '1.0',
      text: 'Approved',
      blocks: [],
    });
  });

  it('opens and publishes views as given', async () => {
    const modal = {
      trigger_id: 't1',
      view: {
        type: 'modal' as const,
        title: { type: 'plain_text' as const, text: 'Hi' },
        blocks: [],
      },
    };
    const home = { user_id: 'U1', view: { type: 'home' as const, blocks: [] } };

    await client.openView(modal, 'xoxb-1');
    await client.publishView(home, 'xoxb-1');

    expect(slack.views.open).toHaveBeenCalledWith(modal);
    expect(slack.views.publish).toHaveBeenCalledWith(home);
  });

  it('returns the file of files.info', async () => {
    expect(await client.getFileInfo('F1', 'xoxb-1')).toEqual({ id: 'F1' });
    expect(slack.files.info).toHaveBeenCalledWith({ file: 'F1' });
  });

  it('passes any other method through', async () => {
    const result = await client.makeCall(
      'users.list',
      { limit: 200 },
      'xoxb-1',
    );

    expect(slack.apiCall).toHaveBeenCalledWith('users.list', { limit: 200 });
    expect(result).toEqual({ ok: true, members: [] });
  });

  it("turns Slack's ok: false into an error", async () => {
    slack.views.publish.mockResolvedValue({
      ok: false,
      error: 'invalid_blocks',
    });
    slack.chat.postMessage.mockResolvedValue({ ok: false });

    await expect(
      client.publishView(
        { user_id: 'U1', view: { type: 'home', blocks: [] } },
        'xoxb-1',
      ),
    ).rejects.toThrow('invalid_blocks');
    await expect(
      client.postMessage({ channel: 'U1', text: 'Hi', accessToken: 'xoxb-1' }),
    ).rejects.toThrow('Failed to send message');
  });
});
