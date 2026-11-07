import { INestApplication } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { slackBodyParserMiddleware } from '@common/middlewares/slack-body-parser.middleware';
import { GlobalExceptionsFilter } from '@common/filters/global-exceptions.filter';

// Everything main.ts sets up on top of AppModule. The integration tests build
// the app through this too, so they run the same pipeline as production.
export function configureApp(app: INestApplication) {
  app.useLogger(app.get(PinoLogger));

  // The one place a request's error is logged and turned into an answer.
  app.useGlobalFilters(new GlobalExceptionsFilter());

  app.use('/api/slack', slackBodyParserMiddleware());

  return app;
}
