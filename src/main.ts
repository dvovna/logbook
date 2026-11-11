import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  configureApp(app);
  // SIGTERM on a deploy closes the app through its shutdown hooks, which
  // stop taking requests and finish the background work first
  // (BackgroundWorkShutdownService), then exits. In a container the process
  // is PID 1, which ignores the signal Nest otherwise sends itself again
  // after the hooks: anything left open would keep it running until killed.
  app.enableShutdownHooks([], { useProcessExit: true });

  const port = process.env[EnvironmentVariable.Port] || 3000;

  await app.listen(port);
}
bootstrap();
