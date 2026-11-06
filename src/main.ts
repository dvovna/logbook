import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  configureApp(app);

  const port = process.env[EnvironmentVariable.Port] || 3000;

  await app.listen(port);
}
bootstrap();
