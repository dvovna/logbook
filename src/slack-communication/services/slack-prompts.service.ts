import { Injectable } from '@nestjs/common';
import { IImportResult } from 'src/user-data-import/user-vacations-import.service';

@Injectable()
export default class SlackPromptsService {
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
}
