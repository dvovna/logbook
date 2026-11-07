import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { pathOf } from '@common/logging/pino-http.options';
import { reportError } from '@common/errors/error-reporter';

// Every error a request ends with comes here, and only here is it logged:
// once, with the stack it was thrown with.
@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const path = pathOf(ctx.getRequest<Request>().url);
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const isClientError = isHttpException && status < 500;
    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    const details = isHttpException
      ? JSON.stringify(exception.getResponse())
      : error.message;

    // A bad signature or an unknown user is the caller's mistake, not a bug:
    // no stack for those.
    if (isClientError) {
      this.logger.warn(`${status} ${details} | Path: ${path}`);
    } else {
      this.logger.error(`${status} ${details} | Path: ${path}`, error.stack);
      reportError(error, { path, status });
    }

    // The answer went out already (Slack is answered before slow work).
    if (response.headersSent) {
      return;
    }

    // The caller learns a client error's own message; anything else may name
    // tables, queries or data, so it stays in the log.
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      error: isClientError ? error.message : 'Internal server error',
    });
  }
}
