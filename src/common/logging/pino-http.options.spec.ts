import { Writable } from 'stream';
import pino from 'pino';
import { pinoHttpOptions } from '@common/logging/pino-http.options';

// What pino writes for a request logged with these options.
const logRequest = (req: Record<string, unknown>) => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  const { redact, serializers } = pinoHttpOptions({ LOG_LEVEL: 'info' });

  pino({ redact, serializers }, destination).info({ req }, 'request');

  return JSON.parse(lines[0]);
};

describe('pinoHttpOptions', () => {
  it('logs no cookies, signatures or query strings', () => {
    const { req } = logRequest({
      method: 'GET',
      url: '/api/slack/oauth/redirect?code=secret-code&state=secret-state',
      query: { code: 'secret-code', state: 'secret-state' },
      headers: {
        cookie: 'slack_oauth_state=secret-state',
        authorization: 'Bearer xoxb-secret',
        'x-slack-signature': 'v0=secret',
        'content-type': 'application/json',
      },
    });

    expect(JSON.stringify(req)).not.toContain('secret');
    expect(req).toMatchObject({
      method: 'GET',
      url: '/api/slack/oauth/redirect',
      headers: {
        cookie: '[redacted]',
        'content-type': 'application/json',
      },
    });
  });

  it('gives every request its own id, and keeps /health out of the log', () => {
    const { genReqId, autoLogging } = pinoHttpOptions({ LOG_LEVEL: 'info' });
    const idOf = genReqId as () => string;
    const ignored = (autoLogging as { ignore: (req: object) => boolean })
      .ignore;

    expect(idOf()).toMatch(/^[0-9a-f-]{36}$/);
    expect(idOf()).not.toBe(idOf());
    expect(ignored({ url: '/health' })).toBe(true);
    expect(ignored({ url: '/api/slack/events' })).toBe(false);
  });
});
