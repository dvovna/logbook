import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { LeaveFileMessageHandler } from '@modules/slack/leave-file/handlers/leave-file-message.handler';
import { LeaveFileMessagesService } from '@modules/slack/leave-file/services/leave-file-messages.service';
import { LeaveFileMessageView } from '@modules/slack/leave-file/views/leave-file-message.view';
import { LeaveFileModule } from 'src/leave-file/leave-file.module';
import { UsersModule } from '@modules/users/users.module';

@Module({
  imports: [SlackCommonModule, LeaveFileModule, UsersModule],
  providers: [
    LeaveFileMessageHandler,
    LeaveFileMessagesService,
    LeaveFileMessageView,
  ],
  exports: [LeaveFileMessagesService],
})
export class LeaveFileMessagesModule {}
