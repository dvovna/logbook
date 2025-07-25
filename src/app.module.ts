import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { VacationModule } from './vacation/vacation.module';
import { SlackModule } from './slack/slack.module';
import { ConfigModule } from '@nestjs/config';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { UsersModule } from './users/users.module';
import { TeamsModule } from './teams/teams.module';
import { ClientsModule } from './clients/clients.module';

@Module({
  imports: [
    ConfigModule.forRoot({}),
    SupabaseModule,
    VacationModule,
    SlackModule,
    UsersModule,
    TeamsModule,
    ClientsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
