import { readFileSync } from 'node:fs';
import { Agent, get, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import express from 'express';
import {
  SHUTDOWN_BUDGET_MS,
  SHUTDOWN_GRACE_MS,
} from '@common/constants/shutdown';
import { BackgroundWorkShutdownService } from '@common/services/background-work-shutdown.service';
import { runInBackground } from '@common/utils/run-in-background';

// Something a test lets happen when it wants to.
const gate = () => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return { open, opened };
};

// Background work this test finishes when it wants to.
const startWork = () => {
  const work = gate();

  runInBackground(new Logger('test'), 'do the work', () => work.opened);

  return work.open;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('BackgroundWorkShutdownService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('lets the app close once the background work is done', async () => {
    const service = new BackgroundWorkShutdownService(new HttpAdapterHost());
    const finish = startWork();
    let closed = false;

    const shutdown = service
      .beforeApplicationShutdown('SIGTERM')
      .then(() => (closed = true));
    await flush();
    expect(closed).toBe(false);

    finish();
    await shutdown;
    expect(closed).toBe(true);
  });

  it('gives up after the grace period and says so', async () => {
    jest.useFakeTimers();
    const service = new BackgroundWorkShutdownService(new HttpAdapterHost());
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const finish = startWork();

    const shutdown = service.beforeApplicationShutdown('SIGTERM');
    await jest.advanceTimersByTimeAsync(SHUTDOWN_GRACE_MS);
    await shutdown;

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('background work still running'),
    );
    finish();
  });

  // Docker kills the process after stop_grace_period; Nest's other hooks
  // and the exit come after the budget.
  it('fits in the stop grace period of docker-compose.yml', () => {
    const compose = readFileSync('docker-compose.yml', 'utf8');
    const [, seconds] = /stop_grace_period: (\d+)s/.exec(compose) ?? [];

    expect(SHUTDOWN_BUDGET_MS + 5_000).toBeLessThanOrEqual(
      Number(seconds) * 1000,
    );
  });

  describe('with the HTTP server', () => {
    let server: Server;
    let port: number;
    let service: BackgroundWorkShutdownService;
    // A request /slow holds until the test lets it answer, then it starts
    // background work.
    let reached: ReturnType<typeof gate>;
    let answer: ReturnType<typeof gate>;
    let finishWork: () => void;
    const keepAlive = new Agent({ keepAlive: true, maxSockets: 1 });

    const request = (path: string, agent: Agent | false = keepAlive) =>
      new Promise<{ status?: number; body: string; connection?: string }>(
        (resolve, reject) => {
          get({ port, path, agent }, (res) => {
            let body = '';

            res.on('data', (chunk: Buffer) => (body += chunk.toString()));
            res.on('end', () =>
              resolve({
                status: res.statusCode,
                body,
                connection: res.headers.connection,
              }),
            );
          }).on('error', reject);
        },
      );

    beforeEach(async () => {
      reached = gate();
      answer = gate();
      service = new BackgroundWorkShutdownService({
        httpAdapter: { getHttpServer: () => server },
      } as unknown as HttpAdapterHost);

      const app = express();

      app.use(service.trackRequests);
      app.get('/slow', async (_req, res) => {
        reached.open();
        await answer.opened;
        finishWork = startWork();
        res.send('done');
      });
      app.get('/fast', (_req, res) => {
        res.send('fast');
      });
      // Sends its headers (keep-alive) before it waits.
      app.get('/stream', async (_req, res) => {
        res.write('part');
        reached.open();
        await answer.opened;
        res.end();
      });

      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterEach(() => {
      server.closeAllConnections();
      server.close();
    });

    afterAll(() => keepAlive.destroy());

    it('takes no new connection, answers the request in flight, then waits for its work', async () => {
      const slow = request('/slow');
      await reached.opened;
      let closed = false;

      const shutdown = service
        .beforeApplicationShutdown('SIGTERM')
        .then(() => (closed = true));

      await expect(request('/fast', false)).rejects.toMatchObject({
        code: 'ECONNREFUSED',
      });

      answer.open();
      expect(await slow).toEqual({
        status: 200,
        body: 'done',
        connection: 'close',
      });
      await flush();
      expect(closed).toBe(false);

      finishWork();
      await shutdown;
      expect(closed).toBe(true);
    });

    // An answer that started before the shutdown keeps its connection open.
    it('refuses a request that still comes on an open connection', async () => {
      const streaming = request('/stream');
      await reached.opened;
      const finish = startWork();

      const shutdown = service.beforeApplicationShutdown('SIGTERM');
      answer.open();
      expect(await streaming).toMatchObject({
        status: 200,
        connection: 'keep-alive',
      });
      await flush();

      expect(await request('/fast')).toEqual({
        status: 503,
        body: 'Shutting down',
        connection: 'close',
      });

      finish();
      await shutdown;
    });
  });
});
