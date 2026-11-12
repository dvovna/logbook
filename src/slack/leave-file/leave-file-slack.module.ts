import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { LeaveFileModule } from 'src/leave-file/leave-file.module';
import { LeaveFileDmService } from '@modules/slack/leave-file/services/leave-file-dm.service';

@Module({
  imports: [SlackCommonModule, LeaveFileModule],
  providers: [LeaveFileDmService],
  exports: [LeaveFileDmService],
})
export class LeaveFileSlackModule {}
