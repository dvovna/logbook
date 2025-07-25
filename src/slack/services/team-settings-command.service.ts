import { Injectable } from '@nestjs/common';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import { IUserViewModel } from 'src/users/types/user.interface';

export enum TeamSettingsSubcommand {
  SetSettings = 'set',
  ListSettings = 'list',
}

@Injectable()
export default class TeamSettingsCommandService {
  public constructor(
    private readonly teamSettingsService: TeamSettingsService,
  ) {}

  public async handleCommand(
    subcommand: TeamSettingsSubcommand | unknown,
    args: string[],
    user: IUserViewModel,
  ) {
    switch (subcommand) {
      case TeamSettingsSubcommand.ListSettings: {
        const settings = await this.teamSettingsService.getByTeamId(
          user.team_id,
        );

        if (!settings) {
          return 'No settings found for your team. Please contact an admin.';
        }

        return `Your team has the following settings: \n Vacation Days - ${settings.vacation_days} \n Bonus Days - ${settings.bonus_days}`;
      }
      case TeamSettingsSubcommand.SetSettings: {
        const [fieldName, value] = args;
        const daysValue = parseInt(value, 10);

        if (!fieldName || !value || isNaN(daysValue)) {
          return 'Invalid parameters. Please provide the field name and value.';
        }

        if (fieldName !== 'vacation_days' && fieldName !== 'bonus_days') {
          return 'Invalid parameters. Please provide valid numbers for vacation and bonus days.';
        }

        await this.teamSettingsService.update(
          { team_id: user.team_id },
          { [fieldName]: daysValue },
          user.id,
        );

        return `Setting ${fieldName} was updated to ${daysValue}.`;
      }
      default: {
        return 'Unknown subcommand. Use `/settings set` or `/settings list`.';
      }
    }
  }
}
