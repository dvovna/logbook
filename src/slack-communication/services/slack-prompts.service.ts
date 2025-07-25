import { Injectable } from '@nestjs/common';
import {
  DEFAULT_BONUS_DAYS,
  DEFAULT_VACATION_DAYS,
} from 'src/team-settings/team-settings.service';
import InteractionActionId from 'src/slack/enums/InteractionActionId';
import { SlackMessagePayload } from 'src/slack/types/SlackMessagePayload';
import { IImportResult } from 'src/user-data-import/user-vacations-import.service';
import { IUserVacationsUsageInfo } from 'src/vacations/types/user-vacations-usage-info.interface';

interface ISlackPromptsService {
  getChangeSettingsPromptMessage(
    params: IChangeSettingsPromptSettingsParams,
  ): SlackMessagePayload;
}

interface IChangeSettingsPromptSettingsParams {
  userId: string;
  teamId: string;
}

@Injectable()
export default class SlackPromptsService implements ISlackPromptsService {
  public getChangeSettingsPromptMessage({
    userId,
    teamId,
  }: IChangeSettingsPromptSettingsParams) {
    return {
      text: '👋 Hello! Thank you for installing the Marina Bot.\n\nBefore we get started, please configure the number of vacation and bonus days for your team.',
      blocks: [
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'vacation_days_block',
          label: {
            type: 'plain_text',
            text: 'Number of vacation days per year',
          },
          element: {
            type: 'plain_text_input',
            action_id: InteractionActionId.VacationDays,
            placeholder: {
              type: 'plain_text',
              text: 'e.g. 20',
            },
            initial_value: DEFAULT_VACATION_DAYS.toString(),
          },
          optional: false,
        },
        {
          type: 'input',
          block_id: 'bonus_days_block',
          label: {
            type: 'plain_text',
            text: 'Number of bonus days per year',
          },
          element: {
            type: 'plain_text_input',
            action_id: InteractionActionId.BonusDays,
            initial_value: DEFAULT_BONUS_DAYS.toString(),
            placeholder: {
              type: 'plain_text',
              text: 'e.g. 3',
            },
          },
          optional: false,
        },
        {
          type: 'actions',
          block_id: 'submit_settings',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Save settings',
              },
              style: 'primary',
              value: `${teamId}_${userId}`,
              action_id: InteractionActionId.SubmitSettings,
            },
          ],
        },
      ],
    } as SlackMessagePayload;
  }

  public getUploadFilePromptMessage() {
    return {
      text: `📎 Please upload a 'user-vacations.csv' file containing user vacations(max 100 vacations).
        Expected format:
        \`email,contractStartDate,vacation[0].startDate,vacation[0].endDate,vacation[0].type,vacation[0].status,...\`

        Examples of \`type\`:
        - \`annual_leave\` — regular paid vacation
        - \`bonus_day\` — additional day off
        - \`sick_leave\` — medical leave
        - \`unpaid_leave\` — leave without pay
        - \`other\` — custom or undefined type

        Examples of \`status\`:
        - \`requested\` — vacation is pending approval
        - \`approved\` — vacation is confirmed
        - \`rejected\` — vacation request was denied

        Sample row:
        \`john.doe@example.com,2022-01-01,2024-08-01,2024-08-10,annual_leave,approved,2024-09-15,2024-09-15,bonus_day,requested\`
        `,
    };
  }

  public getUnknownFileUploadPromptMessage() {
    return {
      text: `❗️ Unknown file type.`,
    };
  }

  public getUserVacationsImportSuccessfulMessage(result: IImportResult) {
    if (result.errors.length) {
      return {
        text: `Import was not successful: \n ${result.errors.join('\n')}`,
      };
    }

    return {
      text: `Import was successful.\n Results: \nCreated: ${result.created}\nUpdated: ${result.updated}\nSkipped: ${result.skipped}.`,
    };
  }

  public getUserVacationsInfoMessage(usageInfo: IUserVacationsUsageInfo) {
    return `
      📊 Your vacation usage for ${new Date().getFullYear()}:

      ✅ Annual Leave:
         • Used: ${usageInfo.annual_leave.used} days
         • Remaining: ${usageInfo.annual_leave.available} days

      ✨ Bonus Days:
         • Used: ${usageInfo.bonus_day.used} days
         • Remaining: ${usageInfo.bonus_day.available} days

      🩺 Sick Leave:
         • Used: ${usageInfo.sick_leave.used} days

      ℹ️ Note: Only approved vacations are counted in usage.
    `;
  }
}
