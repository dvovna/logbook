import { Module } from '@nestjs/common';
import { UsersModule } from '@modules/users/users.module';
import { UsersTabService } from '@modules/slack/tabs/users/services/users-tab.service';
import { UsersTabView } from '@modules/slack/tabs/users/views/users-tab.view';
import EditUserModalViewValuesParser from '@modules/slack/tabs/users/parsers/edit-user-modal-view-values.parser';
import { EditUserFormSubmitHandler } from '@modules/slack/tabs/users/handlers/edit-user-form-submit.handler';
import { ChangeUserStatusFormSubmitHandler } from '@modules/slack/tabs/users/handlers/change-user-status-form-submit.handler';
import { EditUserModalView } from '@modules/slack/tabs/users/views/edit-user-modal.view';
import UsersTabActionHandler from '@modules/slack/tabs/users/handlers/users-tab-action.handler';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UserVacationUsageModalView } from '@modules/slack/tabs/users/views/user-vacation-usage-modal.view';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';

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
