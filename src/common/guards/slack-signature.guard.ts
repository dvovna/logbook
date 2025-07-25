import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';

const FIVE_MINUTES_IN_SECONDS = 5 * 60;

@Injectable()
export class SlackSignatureGuard implements CanActivate {
  private slackSigningSecret = process.env.SLACK_SIGN_IN_SECRET!;
  private logger = new Logger(SlackSignatureGuard.name);

  public canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    const { headers, rawBody } = req;

    const slackSignature = headers['x-slack-signature'];
    const requestTimestamp = headers['x-slack-request-timestamp'];

    const ts = Number(requestTimestamp);
    const now = Math.floor(Date.now() / 1000);

    if (!slackSignature || !requestTimestamp || !rawBody) {
      return false;
    }

    if (isNaN(ts) || Math.abs(now - ts) > FIVE_MINUTES_IN_SECONDS) {
      return false;
    }

    const sigBaseString = `v0:${requestTimestamp}:${rawBody}`;
    const hmac = crypto.createHmac('sha256', this.slackSigningSecret);
    const mySignature =
      'v0=' + hmac.update(sigBaseString, 'utf8').digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(mySignature, 'utf8'),
        Buffer.from(slackSignature, 'utf8'),
      );
    } catch (error) {
      this.logger.error(error.message);
      throw new BadRequestException('Failed to check signature.');
    }
  }
}
