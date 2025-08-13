import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VacationsModule } from 'src/vacations/vacations.module';
import { SlackModule } from './slack/slack.module';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UsersModule } from './users/users.module';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { ClientsModule } from './clients/clients.module';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { TeamSettingsModule } from 'src/team-settings/team-settings.module';
import { CacheModule } from '@nestjs/cache-manager';
import { UserDataImportModule } from 'src/user-data-import/user-data-import.module';
import { TeamSetupModule } from './team-setup/team-setup.module';
import { SlackCommunicationModule } from './slack-communication/slack-communication.module';
import { TeamsModule } from './teams/teams.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
    }),
    CacheModule.register(),
    SupabaseModule,
    VacationsModule,
    UsersModule,
    SlackTeamsModule,
    ClientsModule,
    SlackModule,
    SlackCommunicationModule,
    TeamSettingsModule,
    UserDataImportModule,
    TeamSetupModule,
    TeamsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
