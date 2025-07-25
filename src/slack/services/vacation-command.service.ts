import { Injectable } from '@nestjs/common';
import { UserVacationsUsageService } from 'src/vacations/user-vacation-usage.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';

export enum VacationCommand {
  Usage = 'usage',
}

@Injectable()
export default class VacationCommandService {
  public constructor(
    private readonly userVacationUsageService: UserVacationsUsageService,
    private readonly slackPromptsService: SlackPromptsService,
  ) {}

  public async handleCommand(
    subcommand: VacationCommand | unknown,
    user: IUserViewModel,
  ): Promise<string> {
    switch (subcommand) {
      case VacationCommand.Usage: {
        const usageInfo =
          await this.userVacationUsageService.getUserVacationsUsage(user);

        return this.slackPromptsService.getUserVacationsInfoMessage(usageInfo);
      }
      default:
        return 'Unknown command. Use `/vacation usage`, `/vacation request`, or `/vacation cancel`.';
    }
  }
}
