import { WebAPIRateLimitedError, WebClient } from '@slack/web-api';
import SlackApiClient, {
  CALL_OPTIONS,
  IDLE_CLIENT_MS,
  INTERACTIVE_CALL_OPTIONS,
  slackErrorOf,
  uploadTimeoutMs,
} from 'src/api-clients/third-party/slack-api.client';
import { RESUME_JITTER_MS } from 'src/api-clients/third-party/slack-rate-limits';

jest.mock('@slack/web-api', () => ({
  ...jest.requireActual('@slack/web-api'),
  WebClient: jest.fn(),
}));

// The integration tests replace this client with a fake, so what it sends to
// the Slack Web API is checked here: the method, the token and how the
// arguments are mapped.
describe('SlackApiClient', () => {
  const ok = { ok: true };
  let slack: {
    chat: Record<
      'postEphemeral' | 'postMessage' | 'update' | 'delete',
      jest.Mock
    >;
    views: Record<'open' | 'publish', jest.Mock>;
    files: Record<
      'info' | 'getUploadURLExternal' | 'completeUploadExternal',
      jest.Mock
    >;
    apiCall: jest.Mock;
  };
  let client: SlackApiClient;

  beforeEach(() => {
    slack = {
      chat: {
        postEphemeral: jest.fn().mockResolvedValue(ok),
        postMessage: jest.fn().mockResolvedValue({ ...ok, ts: '1.0' }),
        update: jest.fn().mockResolvedValue(ok),
        delete: jest.fn().mockResolvedValue(ok),
      },
      views: {
        open: jest.fn().mockResolvedValue(ok),
        publish: jest.fn().mockResolvedValue(ok),
      },
      files: {
        info: jest.fn().mockResolvedValue({ ...ok, file: { id: 'F1' } }),
        getUploadURLExternal: jest.fn().mockResolvedValue({
          ...ok,
          upload_url: 'https://files.slack.com/upload/v1/F2',
          file_id: 'F2',
        }),
        completeUploadExternal: jest.fn().mockResolvedValue(ok),
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

  // A client used no more (with token rotation each workspace gets a new
  // token every 12 hours) is dropped.
  it('drops the clients of a token unused for an hour', async () => {
    jest.useFakeTimers();

    try {
      const send = (accessToken: string) =>
        client.postMessage({ channel: 'U1', text: 'Hi', accessToken });

      client = new SlackApiClient();
      await send('xoxb-old');
      await jest.advanceTimersByTimeAsync(IDLE_CLIENT_MS / 2);
      await send('xoxb-new');
      await jest.advanceTimersByTimeAsync(IDLE_CLIENT_MS / 2 + 1);
      await send('xoxb-new');
      expect(WebClient).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(IDLE_CLIENT_MS / 2);
      await send('xoxb-new');
      await send('xoxb-old');

      // The new token's client stayed, the old one's was made again.
      expect((WebClient as unknown as jest.Mock).mock.calls).toEqual([
        ['xoxb-old', CALL_OPTIONS],
        ['xoxb-new', CALL_OPTIONS],
        ['xoxb-old', CALL_OPTIONS],
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  // @slack/web-api would pause all of a client's calls for a rate limit on
  // one of them: the client refuses rate-limited calls, and SlackRateLimits
  // pauses only the method Slack limited.
  it('waits out a rate limit on DMs without holding up the screens', async () => {
    jest.useFakeTimers();

    try {
      const home = {
        user_id: 'U1',
        view: { type: 'home' as const, blocks: [] },
      };
      slack.chat.postMessage.mockRejectedValueOnce(
        new WebAPIRateLimitedError(2),
      );

      const posting = client.postMessage({
        channel: 'U1',
        text: 'Hi',
        accessToken: 'xoxb-1',
      });
      await jest.advanceTimersByTimeAsync(0);
      await client.publishView(home, 'xoxb-1');

      expect(slack.views.publish).toHaveBeenCalledWith(home);
      expect(slack.chat.postMessage).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(2_000 + RESUME_JITTER_MS);
      await expect(posting).resolves.toEqual({ ok: true, ts: '1.0' });
      expect(slack.chat.postMessage).toHaveBeenCalledTimes(2);
      expect(CALL_OPTIONS.rejectRateLimitedCalls).toBe(true);
    } finally {
      jest.useRealTimers();
    }
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

  it('deletes a message', async () => {
    await client.deleteMessage({
      channel: 'D1',
      ts: '1.0',
      accessToken: 'xoxb-1',
    });

    expect(slack.chat.delete).toHaveBeenCalledWith({
      channel: 'D1',
      ts: '1.0',
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

  describe('downloadFileBytes', () => {
    const fileUrl =
      'https://files.slack.com/files-pri/T1-F1/download/user-vacations.csv';
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('email;team_name'));
    });

    afterEach(() => fetchMock.mockRestore());

    it('downloads a Slack file with the token', async () => {
      expect(await client.downloadFileBytes(fileUrl, 'xoxb-1', 100)).toEqual(
        Buffer.from('email;team_name'),
      );
      expect(fetchMock).toHaveBeenCalledWith(fileUrl, {
        headers: { Authorization: 'Bearer xoxb-1' },
      });
    });

    it('sends the token nowhere but to Slack', async () => {
      for (const url of [
        'https://evil.example/files-pri/T1-F1/download/a.csv',
        'http://files.slack.com/files-pri/T1-F1/download/a.csv',
        'https://files.slack.com.evil.example/a.csv',
        'not a url',
      ]) {
        await expect(
          client.downloadFileBytes(url, 'xoxb-1', 100),
        ).rejects.toThrow('Refusing to download');
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a failed download or one over the limit', async () => {
      fetchMock.mockResolvedValueOnce(new Response('', { status: 404 }));
      await expect(
        client.downloadFileBytes(fileUrl, 'xoxb-1', 100),
      ).rejects.toThrow('404');

      fetchMock.mockResolvedValueOnce(new Response('x'.repeat(101)));
      await expect(
        client.downloadFileBytes(fileUrl, 'xoxb-1', 100),
      ).rejects.toThrow('larger than');
    });
  });

  describe('uploadFile and shareFile', () => {
    let fetchMock: jest.SpyInstance;
    const upload = () =>
      client.uploadFile({
        filename: 'report.csv',
        content: 'Name\r\nАнна\r\n',
        accessToken: 'xoxb-1',
      });

    beforeEach(() => {
      fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(''));
    });

    afterEach(() => fetchMock.mockRestore());

    it('gets an upload URL, sends the bytes there, then shares the file', async () => {
      expect(await upload()).toBe('F2');
      expect(slack.files.completeUploadExternal).not.toHaveBeenCalled();

      await client.shareFile({
        fileId: 'F2',
        channelId: 'D1',
        title: 'Report',
        accessToken: 'xoxb-1',
      });

      // Bytes, not characters: "Анна" takes eight.
      expect(slack.files.getUploadURLExternal).toHaveBeenCalledWith({
        filename: 'report.csv',
        length: 16,
      });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://files.slack.com/upload/v1/F2',
        expect.objectContaining({
          method: 'POST',
          body: Buffer.from('Name\r\nАнна\r\n'),
        }),
      );
      // No token goes to the upload URL.
      expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
      expect(slack.files.completeUploadExternal).toHaveBeenCalledWith({
        files: [{ id: 'F2', title: 'Report' }],
        channel_id: 'D1',
      });
    });

    it('uploads nowhere but to Slack', async () => {
      slack.files.getUploadURLExternal.mockResolvedValue({
        ...ok,
        upload_url: 'https://evil.example/upload',
        file_id: 'F2',
      });

      await expect(upload()).rejects.toThrow('Refusing to upload');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails when the bytes did not arrive', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 500 }));

      await expect(upload()).rejects.toThrow('500');
    });

    // A big file takes longer to send than any other call.
    it('waits for the bytes longer the larger the file is, up to a minute', () => {
      const mb = 1024 ** 2;

      expect(uploadTimeoutMs(16)).toBe(CALL_OPTIONS.timeout);
      expect(uploadTimeoutMs(mb)).toBe(11_000);
      expect(uploadTimeoutMs(30 * mb + 1)).toBe(40_000);
      expect(uploadTimeoutMs(500 * mb)).toBe(60_000);
    });
  });

  it("reads the error code of Slack's platform errors", () => {
    expect(
      slackErrorOf(
        Object.assign(new Error('An API error occurred: missing_scope'), {
          data: { ok: false, error: 'missing_scope' },
        }),
      ),
    ).toBe('missing_scope');
    expect(slackErrorOf(new Error('socket hang up'))).toBeUndefined();
    expect(slackErrorOf(null)).toBeUndefined();
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
