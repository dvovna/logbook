import { Server } from 'node:http';
import { BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { SHUTDOWN_GRACE_MS } from '@common/constants/shutdown';
import { finishesWithin } from '@common/utils/finishes-within';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import { markShuttingDown } from '@common/utils/shutdown-state';

// On a deploy the old process gets SIGTERM while it may still be answering
// Slack, or deciding approvals, posting notifications or sending a file after
// it answered. Nest closes the HTTP server only after this hook, so the hook
// stops taking requests itself, first: the server stops listening, and a
// request that still comes on an open connection gets 503 (Slack sends an
// event again later). Then it waits for the requests in flight, and for the
// background work and job runs, for a while; pg-boss and the pool close after
// it (onApplicationShutdown).
@Injectable()
export class BackgroundWorkShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(BackgroundWorkShutdownService.name);

  private readonly inFlight = new Set<Response>();

  private draining = false;

  private whenAnswered: (() => void) | null = null;

  public constructor(private readonly adapterHost: HttpAdapterHost) {}

  // The app's first middleware (configureApp).
  public readonly trackRequests = (
    _req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    if (this.draining) {
      res.setHeader('Connection', 'close');
      res.status(503).send('Shutting down');

      return;
    }

    this.inFlight.add(res);
    res.on('close', () => {
      this.inFlight.delete(res);

      if (!this.inFlight.size) {
        this.whenAnswered?.();
      }
    });
    next();
  };

  public async beforeApplicationShutdown(signal?: string) {
    markShuttingDown();

    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      Server | undefined;

    this.stopTakingRequests(server);

    // Work a request starts counts once the request is answered.
    const finished = await finishesWithin(
      this.requestsAnswered().then(whenBackgroundWorkIsDone),
      SHUTDOWN_GRACE_MS,
    );

    if (!finished) {
      this.logger.warn(
        `Shutting down (${signal ?? 'close'}) with background work still running after ${SHUTDOWN_GRACE_MS} ms`,
      );
    }

    // Nest closes the server next, and waits for its connections: the idle
    // ones go now, and after the wait so do those of requests still running.
    if (finished) {
      server?.closeIdleConnections();
    } else {
      server?.closeAllConnections();
    }
  }

  private stopTakingRequests(server: Server | undefined) {
    this.draining = true;

    // Node keeps a connection open after its answer: these close instead,
    // so that the client sends nothing more on them.
    for (const res of this.inFlight) {
      if (!res.headersSent) {
        res.setHeader('Connection', 'close');
      }
    }

    if (server?.listening) {
      server.close();
    }
  }

  private requestsAnswered(): Promise<void> {
    if (!this.inFlight.size) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.whenAnswered = resolve;
    });
  }
}
