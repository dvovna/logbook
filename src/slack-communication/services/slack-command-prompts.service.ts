import { Injectable } from '@nestjs/common';

@Injectable()
export default class SlackCommandPromptsService {
  public getUploadVacationsPromptMessage() {
    return {
      text: `📎 Please upload a 'user-vacations.csv' file containing user vacations(max 100 vacations).
        Expected format:
        \`email;contractStartDate;vacation[0].startDate;vacation[0].endDate;vacation[0].type;vacation[0].status;...\`

        Examples of \`type\`:
        - \`annual_leave\` — regular paid vacation
        - \`bonus_day\` — additional day off
        - \`sick_leave\` — medical leave
        - \`unpaid_leave\` — leave without pay
        - \`other\` — custom or undefined type

        Examples of \`status\`:
        - \`pending\` — vacation is pending approval
        - \`approved\` — vacation is confirmed
        - \`rejected\` — vacation request was denied
        - \`canceled\` — vacation request was canceled

        Sample row:
        \`john.doe@example.com;2022-01-01;2024-08-01;2024-08-10;annual_leave;approved;2024-09-15;2024-09-15;bonus_day;pending\`
        `,
    };
  }

  public getUserTeamMappingUploadPromptMessage() {
    return {
      text: `📎 Please upload a 'user-team-mapping.csv' file containing user to team mappings.
        Expected format:
        \`email;team_name\`

        Sample row:
        \`john@doe@example.com;Engineering\`
        `,
    };
  }
}
