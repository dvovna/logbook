import { WebAPIRateLimitedError } from '@slack/web-api';
import {
  JOB_RATE_LIMIT_RETRIES,
  RATE_LIMIT_RETRIES,
  RESUME_JITTER_MS,
  retryAfterOf,
  SlackRateLimits,
} from 'src/api-clients/third-party/slack-rate-limits';
import { runAsJob } from '@common/jobs/job-context';

describe('SlackRateLimits', () => {
  let limits: SlackRateLimits;
  const sent: string[] = [];
  // A call that Slack rate-limits `times` times, asking to wait a second.
  const limited = (name: string, times: number) => {
    let refused = 0;

    return () => {
      if (refused < times) {
        refused += 1;

        return Promise.reject(new WebAPIRateLimitedError(1));
      }

      sent.push(name);

      return Promise.resolve(name);
    };
  };
  const call = (name: string) => () => {
    sent.push(name);

    return Promise.resolve(name);
  };
  // Long enough for any pause of a second to end.
  const pauseEnds = () =>
    jest.advanceTimersByTimeAsync(1000 + RESUME_JITTER_MS);

  beforeEach(() => {
    jest.useFakeTimers();
    limits = new SlackRateLimits();
    sent.length = 0;
  });

  afterEach(() => jest.useRealTimers());

  it('waits for as long as Slack asks, then tries again', async () => {
    const posting = limits.call('chat.postMessage', 'xoxb-1', limited('dm', 1));

    await jest.advanceTimersByTimeAsync(999);
    expect(sent).toEqual([]);

    await pauseEnds();
    await expect(posting).resolves.toBe('dm');
  });

  // Slack limits each method per workspace: a burst of DMs leaves the
  // screens alone.
  it('pauses the limited method of that token only', async () => {
    const posting = limits.call('chat.postMessage', 'xoxb-1', limited('dm', 1));
    await jest.advanceTimersByTimeAsync(0);

    await limits.call('views.publish', 'xoxb-1', call('home'));
    await limits.call('chat.postMessage', 'xoxb-2', call('other workspace'));
    const waiting = limits.call('chat.postMessage', 'xoxb-1', call('next dm'));
    await jest.advanceTimersByTimeAsync(0);

    expect(sent).toEqual(['home', 'other workspace']);

    await pauseEnds();
    await Promise.all([posting, waiting]);
    expect(sent).toEqual(['home', 'other workspace', 'dm', 'next dm']);
  });

  // Nobody looks at a screen while a job runs, and a failed job is retried
  // only minutes later.
  it('gives up after its retries, and a job after more', async () => {
    const tries = async ({ inJob }: { inJob: boolean }) => {
      const attempt = jest.fn(() =>
        Promise.reject(new WebAPIRateLimitedError(1)),
      );
      const calling = () => limits.call('chat.postMessage', 'xoxb-1', attempt);
      const failed = expect(
        inJob ? runAsJob(calling) : calling(),
      ).rejects.toThrow('A rate-limit has been reached');

      await jest.advanceTimersByTimeAsync(
        (JOB_RATE_LIMIT_RETRIES + 1) * (1000 + RESUME_JITTER_MS),
      );
      await failed;

      return attempt.mock.calls.length;
    };

    expect(await tries({ inJob: false })).toBe(RATE_LIMIT_RETRIES + 1);
    expect(await tries({ inJob: true })).toBe(JOB_RATE_LIMIT_RETRIES + 1);
    expect(JOB_RATE_LIMIT_RETRIES).toBeGreaterThan(RATE_LIMIT_RETRIES);
  });

  it('passes any other failure on at once', async () => {
    const failing = jest.fn(() =>
      Promise.reject(new Error('An API error occurred: missing_scope')),
    );

    await expect(
      limits.call('chat.postMessage', 'xoxb-1', failing),
    ).rejects.toThrow('missing_scope');
    expect(failing).toHaveBeenCalledTimes(1);
    // Nothing was paused.
    await limits.call('chat.postMessage', 'xoxb-1', call('dm'));
    expect(sent).toEqual(['dm']);
  });

  it("reads Retry-After from the library's rate limit error only", () => {
    expect(retryAfterOf(new WebAPIRateLimitedError(30))).toBe(30);
    expect(
      retryAfterOf(
        Object.assign(new Error('An API error occurred: ratelimited'), {
          code: 'slack_webapi_platform_error',
          data: { ok: false, error: 'ratelimited' },
        }),
      ),
    ).toBeUndefined();
    expect(retryAfterOf(null)).toBeUndefined();
  });
});
