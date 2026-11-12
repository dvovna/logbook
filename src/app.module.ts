import { Logger, Module } from '@nestjs/common';
import { BackgroundWorkShutdownService } from '@common/services/background-work-shutdown.service';
import { EventTrackingService } from '@common/services/event-tracking.service';
import { JobsModule } from '@common/jobs/jobs.module';
import { AppController } from './app.controller';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { SlackModule } from './slack/slack.module';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from 'src/database/database.module';
import { UsersModule } from './users/users.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ApiClientsModule } from 'src/api-clients/api-clients.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { CacheModule } from '@nestjs/cache-manager';
import { UserDataImportModule } from '@modules/user-data-import/user-data-import.module';
import { TeamSetupModule } from './team-setup/team-setup.module';
import { SlackCommunicationModule } from './slack-communication/slack-communication.module';
import { TeamsModule } from './teams/teams.module';
import { envSchema } from 'src/env.schema';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RequestWorkflowsModule } from './request-workflows/request-workflows.module';
import { LoggerModule } from 'nestjs-pino';
import { pinoHttpOptions } from '@common/logging/pino-http.options';
import { ClientsModule } from '@modules/clients/clients.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { TimeOffLoggingModule } from 'src/time-off-logging/time-off-logging.module';
import { TeamFileModule } from 'src/team-file/team-file.module';
import { LeaveFileModule } from 'src/leave-file/leave-file.module';

@Module({
  imports: [
    JobsModule,
    LoggerModule.forRoot({ pinoHttp: pinoHttpOptions() }),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const parsed = envSchema.safeParse(config);
        const logger = new Logger('ConfigValidation');

        if (!parsed.success) {
          logger.error(
            '❌ Invalid environment variables',
            parsed.error.flatten().fieldErrors,
          );
          process.exit(1);
        }
        return parsed.data;
      },
    }),
    EventEmitterModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    CacheModule.register(),
    DatabaseModule,
    VacationRequestsModule,
    UsersModule,
    SlackTeamsModule,
    ApiClientsModule,
    SlackModule,
    SlackCommunicationModule,
    VacationPoliciesModule,
    UserDataImportModule,
    TeamSetupModule,
    TeamsModule,
    ClientsModule,
    RequestWorkflowsModule,
    TimeEntriesModule,
    TimeOffLoggingModule,
    TeamFileModule,
    LeaveFileModule,
  ],
  controllers: [AppController],
  providers: [BackgroundWorkShutdownService, EventTrackingService],
})
export class AppModule {}
