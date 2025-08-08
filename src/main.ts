import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { slackBodyParserMiddleware } from 'src/common/middlewares/slack-body-parser.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use('/api/slack', slackBodyParserMiddleware());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
