import * as express from 'express';
import * as qs from 'qs';
import { Request } from 'express';

export function slackBodyParserMiddleware(): express.RequestHandler[] {
  return [
    express.raw({
      type: '*/*',
      verify: (req: Request, _res, buf) => {
        (req as Request & { rawBody: Buffer | string }).rawBody =
          buf.toString();
      },
    }),
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
