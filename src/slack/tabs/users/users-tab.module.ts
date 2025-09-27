import { Module } from '@nestjs/common';
import { UsersModule } from 'src/users/users.module';
import { UsersTabService } from 'src/slack/tabs/users/services/users-tab.service';
import { UsersTabView } from 'src/slack/tabs/users/views/users-tab.view';
import EditUserModalViewValuesParser from 'src/slack/tabs/users/parsers/edit-user-modal-view-values.parser';
import { EditUserFormSubmitHandler } from 'src/slack/tabs/users/handlers/edit-user-form-submit.handler';
import { ChangeUserStatusFormSubmitHandler } from 'src/slack/tabs/users/handlers/change-user-status-form-submit.handler';
import { EditUserModalView } from 'src/slack/tabs/users/views/edit-user-modal.view';
import UsersTabActionHandler from 'src/slack/tabs/users/handlers/users-tab-action.handler';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { TeamsModule } from 'src/teams/teams.module';
import { UserVacationUsageModalView } from 'src/slack/tabs/users/views/user-vacation-usage-modal.view';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';

@Module({
  imports: [
    UsersModule,
    TeamsModule,
    SlackCommonModule,
    VacationRequestsModule,
  ],
  providers: [
    UsersTabService,
    UsersTabView,
    EditUserModalViewValuesParser,
    EditUserFormSubmitHandler,
    ChangeUserStatusFormSubmitHandler,
    EditUserModalView,
    UserVacationUsageModalView,
    UsersTabView,
    UsersTabActionHandler,
  ],
  exports: [UsersTabService],
})
export class UsersTabModule {}
