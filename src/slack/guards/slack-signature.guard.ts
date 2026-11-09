import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

const FIVE_MINUTES_IN_SECONDS = 5 * 60;

// Checks Slack's signature of the raw body. Anything that doesn't match,
// whatever its shape, is refused with 403 (Nest's answer to `false`).
@Injectable()
export class SlackSignatureGuard implements CanActivate {
  private slackSigningSecret =
    process.env[EnvironmentVariable.SlackSignInSecret]!;

  public canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const { headers, rawBody } = req;

    const slackSignature = headers['x-slack-signature'];
    const requestTimestamp = headers['x-slack-request-timestamp'];

    const ts = Number(requestTimestamp);
    const now = Math.floor(Date.now() / 1000);

    if (typeof slackSignature !== 'string' || !requestTimestamp || !rawBody) {
      return false;
    }

    if (isNaN(ts) || Math.abs(now - ts) > FIVE_MINUTES_IN_SECONDS) {
      return false;
    }

    const sigBaseString = `v0:${requestTimestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', this.slackSigningSecret);
    const expected = Buffer.from(
      'v0=' + hmac.update(sigBaseString, 'utf8').digest('hex'),
      'utf8',
    );
    const received = Buffer.from(slackSignature, 'utf8');

    // timingSafeEqual throws on buffers of different lengths; the length of
    // a valid signature is no secret.
    return (
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received)
    );
  }
}
