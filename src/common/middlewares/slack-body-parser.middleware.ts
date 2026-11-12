import * as express from 'express';
import * as qs from 'qs';
import { Request } from 'express';
import { PayloadTooLargeException } from '@nestjs/common';

// A click in App Home carries the whole view: a billing report of 100 rows
// with names in Cyrillic is just over the 100 KB Express takes by default
// (test/integration/request-size.int-spec.ts). A view has at most 100
// blocks, and the app's biggest stays under a quarter of this.
export const SLACK_BODY_LIMIT_BYTES = 1024 * 1024;

const tooLargeAsClientError: express.ErrorRequestHandler = (
  error: { type?: string },
  _req,
  _res,
  next,
) =>
  next(
    error?.type === 'entity.too.large'
      ? new PayloadTooLargeException('The request body is too large')
      : error,
  );

export function slackBodyParserMiddleware(): (
  express.RequestHandler | express.ErrorRequestHandler
)[] {
  return [
    express.raw({
      type: '*/*',
      limit: SLACK_BODY_LIMIT_BYTES,
      verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody: Buffer | string }).rawBody =
          buf.toString();
      },
    }),
    // A body over the limit is the sender's mistake: a 413, not a server
    // error.
    tooLargeAsClientError,
    (req: Request & { rawBody: string }, _res, next) => {
      const contentType = req.headers['content-type'] || '';

      try {
        if (contentType.includes('application/json')) {
          req.body = JSON.parse(req.rawBody);
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          req.body = qs.parse(req.rawBody);
        } else {
          req.body = req.rawBody;
        }

        next();
      } catch (e) {
        next(e);
      }
    },
  ];
}
