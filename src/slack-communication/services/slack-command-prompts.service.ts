import { Injectable } from '@nestjs/common';
import { KnownBlock } from '@slack/types';

// Up to these in one file (FileUploadService, the import service).
const LIMITS = 'up to 1000 lines and 1 MB';

const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

const steps = (fileName: string) =>
  section(
    [
      '*How:*',
      `1. Save the file as \`${fileName}\`. The name has to be exactly this.`,
      '2. Upload it in your conversation with Logbook: its Messages tab, or drag it into this conversation.',
      '3. Logbook imports it and answers with a summary.',
    ].join('\n'),
  );

// What an admin needs to import vacation history, from `/upload-vacations`
// or the Users tab.
@Injectable()
export default class SlackCommandPromptsService {
  public getInstructionBlocks(): KnownBlock[] {
    return [
      section(
        "*📥 Import vacation history*\nSets each person's contract start date and *replaces their vacations* with the ones in the file.",
      ),
      steps('user-vacations.csv'),
      section(
        `*Format:* one person per line, fields separated by \`;\`, ${LIMITS}. A person can have any number of vacations, four fields each:\n\`\`\`email;contractStartDate;startDate;endDate;type;status;startDate;endDate;type;status;...\`\`\``,
      ),
      section(
        '*Example:*\n```john.doe@example.com;2022-01-01;2024-08-01;2024-08-10;annual_leave;approved;2024-09-15;2024-09-15;bonus_day;pending```',
      ),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Dates as `YYYY-MM-DD` · Types: `annual_leave`, `bonus_day`, `sick_leave`, `unpaid_leave`, `other` · Statuses: `pending`, `approved`, `rejected`, `canceled`',
          },
        ],
      },
    ];
  }

  public getUploadVacationsPromptMessage() {
    return {
      text: '📥 Import vacation history: upload user-vacations.csv in this conversation.',
      blocks: this.getInstructionBlocks(),
    };
  }
}
