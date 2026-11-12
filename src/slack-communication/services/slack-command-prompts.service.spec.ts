import UserVacationsCsvParser from '@modules/user-data-import/parsers/user-vacations-csv.parser';
import SlackCommandPromptsService from '@modules/slack-communication/services/slack-command-prompts.service';

// The file the prompt shows, as an admin would copy it.
const shownExample = () => {
  const texts = new SlackCommandPromptsService()
    .getInstructionBlocks()
    .flatMap((block) =>
      block.type === 'section' && block.text ? [block.text.text] : [],
    );
  const example = texts.find((text) => text.startsWith('*Example:*'));

  return /```\n?([\s\S]*?)```/.exec(example ?? '')?.[1];
};

describe('the /upload-vacations prompt', () => {
  it('shows a file the parser reads', async () => {
    const records = await new UserVacationsCsvParser().parseCsv(
      shownExample()!,
    );

    expect(
      records.map(({ email, vacations }) => [email, vacations.length]),
    ).toEqual([
      ['john.doe@example.com', 2],
      ['jane.roe@example.com', 1],
    ]);
  });

  it('starts the example with the header row', () => {
    expect(shownExample()).toMatch(
      /^email;contractStartDate;vacation\[0\]\.startDate;/,
    );
  });
});
