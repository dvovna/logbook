import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { SlackModule } from './slack/slack.module';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UsersModule } from './users/users.module';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { ClientsModule } from './clients/clients.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { CacheModule } from '@nestjs/cache-manager';
import { UserDataImportModule } from 'src/user-data-import/user-data-import.module';
import { TeamSetupModule } from './team-setup/team-setup.module';
import { SlackCommunicationModule } from './slack-communication/slack-communication.module';
import { TeamsModule } from './teams/teams.module';
import { envSchema } from 'src/env.schema';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RequestWorkflowsModule } from './request-workflows/request-workflows.module';
import { LoggerModule } from 'nestjs-pino';

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const parsed = envSchema.safeParse(config);
        if (!parsed.success) {
          console.error(
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
    SupabaseModule,
    VacationRequestsModule,
    UsersModule,
    SlackTeamsModule,
    ClientsModule,
    SlackModule,
    SlackCommunicationModule,
    VacationPoliciesModule,
    UserDataImportModule,
    TeamSetupModule,
    TeamsModule,
    RequestWorkflowsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
