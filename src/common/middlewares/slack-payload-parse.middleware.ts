import {
  Injectable,
  Logger,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Request } from 'express';

@Injectable()
export class SlackPayloadParseMiddleware implements NestMiddleware {
  private readonly logger = new Logger(SlackPayloadParseMiddleware.name);

  public use(req: Request, res: Response, next: NextFunction) {
    if (req.body.payload && typeof req.body.payload !== 'string') {
      this.logger.log(
        'SlackPayloadParseInterceptor: Missing or invalid payload',
      );

      throw new UnauthorizedException('Missing or invalid payload');
    }

    try {
      req.body = JSON.parse(req.body.payload);

      return next();
    } catch (e) {
      this.logger.log(
        'SlackPayloadParseInterceptor: Payload is not valid JSON',
        e,
      );

      throw new UnauthorizedException('Payload is not valid JSON');
    }
  }
}
