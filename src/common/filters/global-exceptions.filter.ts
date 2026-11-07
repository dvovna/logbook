import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { pathOf } from '@common/logging/pino-http.options';

@Catch()
export class GlobalExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.getResponse()
        : (exception as Error).message;
    const path = pathOf(request.url);

    this.logger.error(
      `Error: ${JSON.stringify(message)} | Path: ${path}`,
      (exception as Error).stack,
    );

    // The caller gets what an HTTP error says about itself; anything else may
    // name tables, queries or data, so it stays in the log.
    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path,
      error:
        exception instanceof HttpException ? message : 'Internal server error',
    });
  }
}
