import * as crypto from 'crypto';
import { ExecutionContext } from '@nestjs/common';
import { SlackSignatureGuard } from 'src/slack/guards/slack-signature.guard';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';

const SECRET = 'test-signing-secret';

const contextOf = (headers: Record<string, unknown>, rawBody = 'token=x') =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers, rawBody }) }),
  }) as unknown as ExecutionContext;

const sign = (timestamp: string, body: string) =>
  'v0=' +
  crypto
    .createHmac('sha256', SECRET)
    .update(`v0:${timestamp}:${body}`, 'utf8')
    .digest('hex');

describe('SlackSignatureGuard', () => {
  let guard: SlackSignatureGuard;
  const timestamp = () => String(Math.floor(Date.now() / 1000));

  beforeEach(() => {
    process.env[EnvironmentVariable.SlackSignInSecret] = SECRET;
    guard = new SlackSignatureGuard();
  });

  it("lets Slack's signature through", () => {
    const ts = timestamp();

    expect(
      guard.canActivate(
        contextOf({
          'x-slack-signature': sign(ts, 'token=x'),
          'x-slack-request-timestamp': ts,
        }),
      ),
    ).toBe(true);
  });

  it.each([
    ['of the right length', () => sign(timestamp(), 'token=y')],
    ['shorter than a real one', () => 'v0=abc'],
    ['longer than a real one', () => `${sign(timestamp(), 'token=x')}00`],
    ['with characters of several bytes', () => 'v0=' + 'é'.repeat(32)],
  ])('refuses a wrong signature %s, without throwing', (_, signature) => {
    expect(
      guard.canActivate(
        contextOf({
          'x-slack-signature': signature(),
          'x-slack-request-timestamp': timestamp(),
        }),
      ),
    ).toBe(false);
  });

  it('refuses the signature header sent twice', () => {
    const ts = timestamp();
    const signature = sign(ts, 'token=x');

    expect(
      guard.canActivate(
        contextOf({
          'x-slack-signature': [signature, signature],
          'x-slack-request-timestamp': ts,
        }),
      ),
    ).toBe(false);
  });

  it('refuses a request older than five minutes', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 6 * 60);

    expect(
      guard.canActivate(
        contextOf({
          'x-slack-signature': sign(ts, 'token=x'),
          'x-slack-request-timestamp': ts,
        }),
      ),
    ).toBe(false);
  });
});
