import { ErrorCode } from '@slack/web-api';
import { isInJob } from '@common/jobs/job-context';
import delay from '@common/utils/delay';

// How many times a call waits out a rate limit and tries again. A job's call
// waits more often: nobody looks at a screen meanwhile, and a failed job is
// retried only minutes later.
export const RATE_LIMIT_RETRIES = 3;
export const JOB_RATE_LIMIT_RETRIES = 6;

// Slack's Retry-After is in whole seconds: a pause ends up to this much
// later, so that the first call after it doesn't land on the window's edge.
export const RESUME_JITTER_MS = 500;

// The seconds Slack asked to wait (Retry-After) when `error` is its rate
// limit, as @slack/web-api throws it with rejectRateLimitedCalls; undefined
// for any other failure.
export const retryAfterOf = (error: unknown): number | undefined => {
  const { code, retryAfter } = (error ?? {}) as {
    code?: unknown;
    retryAfter?: unknown;
  };

  return code === ErrorCode.RateLimitedError && typeof retryAfter === 'number'
    ? retryAfter
    : undefined;
};

// Slack limits each method per workspace, so a rate limit pauses the calls
// of that method with that token for as long as Slack asked, and no others:
// a burst of DMs leaves views.publish alone. @slack/web-api would pause every
// call of its WebClient instead, so the clients reject rate-limited calls
// (rejectRateLimitedCalls) and they are waited out here.
export class SlackRateLimits {
  // The paused methods, by method and token, until the pause is over.
  private readonly pauses = new Map<string, Promise<void>>();

  public async call<T>(
    method: string,
    token: string | undefined,
    task: () => Promise<T>,
  ): Promise<T> {
    const key = `${method}:${token ?? ''}`;
    const retries = isInJob() ? JOB_RATE_LIMIT_RETRIES : RATE_LIMIT_RETRIES;

    for (let attempt = 0; ; attempt += 1) {
      const pause = this.pauses.get(key);

      // The calls waiting for one pause go on in the order they came, as a
      // paused WebClient's do: two updates of one message or one screen
      // must not swap.
      if (pause) {
        await pause;
      }

      try {
        return await task();
      } catch (error) {
        const retryAfter = retryAfterOf(error);

        if (retryAfter === undefined || attempt >= retries) {
          throw error;
        }

        this.pause(key, retryAfter);
      }
    }
  }

  private pause(key: string, retryAfterSeconds: number) {
    // Calls that went out before the pause began come back rate-limited too:
    // the first one's pause stands.
    if (this.pauses.has(key)) {
      return;
    }

    this.pauses.set(
      key,
      delay(retryAfterSeconds * 1000 + Math.random() * RESUME_JITTER_MS).then(
        () => {
          this.pauses.delete(key);
        },
      ),
    );
  }
}
