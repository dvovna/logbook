import { Logger, Module } from '@nestjs/common';
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
import { ClientsModule } from '@modules/clients/clients.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'HH:MM:ss.l',
                ignore: 'pid,hostname',
              },
            }
            : undefined,
      },
    }),
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
  ],
  controllers: [AppController],
})
export class AppModule {}
