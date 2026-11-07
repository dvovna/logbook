import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { SupabaseClient } from '@supabase/supabase-js';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { SupabaseService } from 'src/database/supabase.service';
import { Database } from '@common/types/database.types';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import {
  trackInBackground,
  whenBackgroundWorkIsDone,
} from '@common/utils/run-in-background';
import { FakeSlackApiClient } from './fake-slack-api.client';
import { SlackTestClient } from './slack-test-client';
import { TestWorkspace } from './test-workspace';
import { assertLocalUrl } from './local-url';

export interface ITestApp {
  app: INestApplication;
  // Every Slack Web API call the app made.
  slackApi: FakeSlackApiClient;
  // Sends signed Slack requests to the app.
  slack: SlackTestClient;
  db: SupabaseClient<Database>;
  // Resolves once the app has finished the work it does after answering
  // Slack (event handlers, EventEmitter listeners, tab updates).
  idle(): Promise<void>;
  createWorkspace(): Promise<TestWorkspace>;
  close(): Promise<void>;
}

// The real AppModule and request pipeline (main.ts), on the local Supabase
// stack. Only SlackApiClient is replaced.
export const createTestApp = async (): Promise<ITestApp> => {
  const slackApi = new FakeSlackApiClient();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SlackApiClient)
    .useValue(slackApi)
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  // Otherwise supertest starts the server for every request on a random port
  // of all addresses and sends to 127.0.0.1: when another local process
  // listens on 127.0.0.1 with that port, it gets the request.
  await app.listen(0, '127.0.0.1');
  trackEventListeners(app.get(EventEmitter2));

  // Second line of defence after global-setup: what the app actually uses.
  assertLocalUrl(
    'SUPABASE_URL',
    app.get(ConfigService).get(EnvironmentVariable.SupabaseUrl),
  );

  const db = app.get(SupabaseService).getClient();
  const workspaces: TestWorkspace[] = [];

  return {
    app,
    slackApi,
    slack: new SlackTestClient(app.getHttpServer()),
    db,
    idle: whenBackgroundWorkIsDone,
    createWorkspace: async () => {
      const workspace = await TestWorkspace.create(db);
      workspaces.push(workspace);

      return workspace;
    },
    close: async () => {
      await Promise.all(workspaces.map((workspace) => workspace.destroy()));
      await app.close();
    },
  };
};

// EventEmitter2.emit runs the listeners (@OnEvent, tab navigation) without
// returning their promises. emitAsync runs them the same way and returns
// one, so that idle() can wait for them too.
function trackEventListeners(eventEmitter: EventEmitter2) {
  eventEmitter.emit = (event, ...values) => {
    // Nest logs a failing listener; its error must not end the test run.
    trackInBackground(
      eventEmitter.emitAsync(event, ...values).catch(() => undefined),
    );

    return eventEmitter.listeners(event).length > 0;
  };
}
