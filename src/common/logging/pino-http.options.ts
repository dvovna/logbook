import { Options } from 'pino-http';

// A URL without its query string: the OAuth redirect carries the one-time
// code and the state in it.
const withoutQuery = (url?: string) => url?.split('?')[0];

// How HTTP requests are logged. Cookies hold the OAuth state, the signature
// header is a MAC of the body, and query strings can hold the OAuth code, so
// none of them is written to the logs.
export const pinoHttpOptions = (env = process.env): Options => ({
  level: env.LOG_LEVEL || (env.NODE_ENV === 'production' ? 'info' : 'debug'),
  transport:
    env.NODE_ENV !== 'production' && env.NODE_ENV !== 'test'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-slack-signature"]',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  serializers: {
    req: (req: { url?: string; query?: unknown }) => ({
      ...req,
      url: withoutQuery(req.url),
      query: undefined,
    }),
  },
});

export const pathOf = withoutQuery;
