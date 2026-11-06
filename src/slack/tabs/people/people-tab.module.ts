import { Module } from '@nestjs/common';
import { UsersModule } from '@modules/users/users.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { PeopleTabService } from '@modules/slack/tabs/people/services/people-tab.service';
import { PeopleTabView } from '@modules/slack/tabs/people/views/people-tab.view';
import PeopleTabActionHandler from '@modules/slack/tabs/people/handlers/people-tab-action.handler';

@Module({
  imports: [
    UsersModule,
    TeamsModule,
    SlackCommonModule,
  ],
  providers: [
    PeopleTabActionHandler,
    PeopleTabService,
    PeopleTabView,
  ],
  exports: [PeopleTabService],
})
export class PeopleTabModule {}
