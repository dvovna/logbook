import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { slackBodyParserMiddleware } from 'src/common/middlewares/slack-body-parser.middleware';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use('/api/slack', slackBodyParserMiddleware());

  await app.listen(process.env[EnvironmentVariable.Port] ?? 3000);
}
bootstrap();
