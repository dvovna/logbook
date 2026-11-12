import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TeamFileModule } from 'src/team-file/team-file.module';
import { TeamFileDmService } from '@modules/slack/team-file/services/team-file-dm.service';

@Module({
  imports: [SlackCommonModule, TeamFileModule],
  providers: [TeamFileDmService],
  exports: [TeamFileDmService],
})
export class TeamFileSlackModule {}
