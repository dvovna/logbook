import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import SlackApiClient from 'src/api-clients/third-party/slack-api.client';
import { DatabaseService } from 'src/database/database.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';
import {
  DEFAULT_JOBS_OPTIONS,
  JOBS_OPTIONS,
  JobsService,
} from '@common/jobs/jobs.service';
import { FakeSlackApiClient } from './fake-slack-api.client';
import { FakeNagerDateClient } from './fake-nager-date.client';
import { NagerDateClient } from 'src/holidays/clients/nager-date.client';
import { SlackTestClient } from './slack-test-client';
import { TestDatabase, TestWorkspace } from './test-workspace';
import { assertLocalUrl } from './local-url';
import { createSqlLog, ISqlLog } from './sql-log';

export interface ITestApp {
  app: INestApplication;
  // Every Slack Web API call the app made.
  slackApi: FakeSlackApiClient;
  // Public holidays the app imports by country, instead of Nager.Date.
  nager: FakeNagerDateClient;
  // Sends signed Slack requests to the app.
  slack: SlackTestClient;
  // The app's pool, outside any transaction of the app.
  db: TestDatabase;
  sql: ISqlLog;
  // Resolves once the app has finished the work it does after answering
  // Slack (event handlers, EventEmitter listeners, tab updates).
  idle(): Promise<void>;
  // Runs the saved jobs that wait for a retry now, instead of minutes later,
  // and waits for what they start.
  retryJobs(): Promise<void>;
  createWorkspace(): Promise<TestWorkspace>;
  close(): Promise<void>;
}

export interface ITestAppOptions {
  // Another app's Slack, for two app processes on one database and one
  // Slack, as during a deploy.
  slackApi?: FakeSlackApiClient;
}

// The real AppModule and request pipeline (main.ts), on the local Supabase
// stack. Only the outside services are replaced: Slack and Nager.Date.
export const createTestApp = async ({
  slackApi = new FakeSlackApiClient(),
}: ITestAppOptions = {}): Promise<ITestApp> => {
  const sqlLog = createSqlLog();
  const nager = new FakeNagerDateClient();
  // Each app has its own job tables: test files run in parallel, and other
  // checkouts may run their tests against the same database.
  const jobsSchema = `pgboss_test_${randomUUID().slice(0, 8)}`;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SlackApiClient)
    .useValue(slackApi)
    .overrideProvider(NagerDateClient)
    .useValue(nager)
    .overrideProvider(JOBS_OPTIONS)
    .useValue({
      ...DEFAULT_JOBS_OPTIONS,
      schema: jobsSchema,
      pollIntervalSeconds: 0,
      maintenance: false,
    })
    .compile();

  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app);
  await app.init();
  // Otherwise supertest starts the server for every request on a random port
  // of all addresses and sends to 127.0.0.1: when another local process
  // listens on 127.0.0.1 with that port, it gets the request.
  await app.listen(0, '127.0.0.1');

  // Second line of defence after global-setup: what the app actually uses.
  const databaseUrl = app
    .get(ConfigService)
    .get<string>(EnvironmentVariable.DatabaseUrl);
  assertLocalUrl('DATABASE_URL', databaseUrl);

  const db = app.get(DatabaseService).db;
  const workspaces: TestWorkspace[] = [];

  return {
    app,
    slackApi,
    nager,
    slack: new SlackTestClient(app.getHttpServer()),
    db,
    sql: sqlLog,
    idle: whenBackgroundWorkIsDone,
    retryJobs: async () => {
      await app.get(JobsService).runDueJobs({ includeNotDue: true });
      await whenBackgroundWorkIsDone();
    },
    createWorkspace: async () => {
      const workspace = await TestWorkspace.create(db);
      workspaces.push(workspace);

      return workspace;
    },
    close: async () => {
      await Promise.all(workspaces.map((workspace) => workspace.destroy()));
      await app.close();
      await dropJobsSchema(databaseUrl!, jobsSchema);
    },
  };
};

async function dropJobsSchema(databaseUrl: string, schema: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`drop schema if exists "${schema}" cascade`);
  } finally {
    await client.end();
  }
}
