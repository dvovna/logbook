import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { slackBodyParserMiddleware } from '@common/middlewares/slack-body-parser.middleware';
import { GlobalExceptionsFilter } from '@common/filters/global-exceptions.filter';
import { GlobalErrorInterceptor } from '@common/interceptors/global-error.interceptor';
import { SlackErrorInterceptor } from '@common/interceptors/slack-error.interceptor';
import { Logger as PinoLogger } from 'nestjs-pino';
import EnvironmentVariable from '@common/enums/environment-variable.enum';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(PinoLogger));

  app.useGlobalFilters(new GlobalExceptionsFilter());
  app.useGlobalInterceptors(
    new GlobalErrorInterceptor(),
    new SlackErrorInterceptor(),
  );

  app.use('/api/slack', slackBodyParserMiddleware());

  const port = process.env[EnvironmentVariable.Port] || 3000;

  await app.listen(port);
}
bootstrap();
