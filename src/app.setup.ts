import { INestApplication } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { slackBodyParserMiddleware } from '@common/middlewares/slack-body-parser.middleware';
import { GlobalExceptionsFilter } from '@common/filters/global-exceptions.filter';
import { initErrorReporting } from '@common/errors/error-reporter';
import { BackgroundWorkShutdownService } from '@common/services/background-work-shutdown.service';

// Everything main.ts sets up on top of AppModule. The integration tests build
// the app through this too, so they run the same pipeline as production.
export function configureApp(app: INestApplication) {
  // Before any other middleware: once the app shuts down it refuses new
  // requests, and it waits for the ones in flight.
  app.use(app.get(BackgroundWorkShutdownService).trackRequests);
  app.useLogger(app.get(PinoLogger));
  // The env is loaded and validated by now (ConfigModule in AppModule).
  initErrorReporting();

  // The one place a request's error is logged and turned into an answer.
  app.useGlobalFilters(new GlobalExceptionsFilter());

  app.use('/api/slack', slackBodyParserMiddleware());

  return app;
}
