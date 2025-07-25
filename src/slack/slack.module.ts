import { Module } from '@nestjs/common';
import { SlackController } from 'src/slack/slack.controller';
import { VacationModule } from 'src/vacation/vacation.module';
import { SlackService } from 'src/slack/slack.service';
import { ClientsModule } from 'src/clients/clients.module';

@Module({
  imports: [VacationModule, ClientsModule],
  controllers: [SlackController],
  providers: [SlackService],
})
export class SlackModule {}
