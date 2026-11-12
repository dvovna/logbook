import { checkSetupFile } from 'src/commands/setup-files/check-setup-file';
import { checkFiles } from 'src/commands/setup-files/setup-files.command';

const TODAY = '2026-11-12';

const csv = (...lines: string[]) => Buffer.from(lines.join('\n'));

const check = (name: string, ...lines: string[]) =>
  checkSetupFile(csv(...lines), name, TODAY);

describe('checkSetupFile', () => {
  it('reads a team file with nobody known as a workspace of new teams', async () => {
    const result = await check(
      'team-setup.csv',
      'Name,Email,Team,Team lead',
      'Ada,ada@example.com,Engineering,yes',
      'Bob,bob@example.com,engineering,',
      'Cleo,cleo@example.com,Sales,',
      'Dan,dan@example.com,,',
    );

    expect(result).toEqual({
      kind: 'team',
      rows: 4,
      problems: [],
      summary: [
        'Team "Engineering": 2 people, 1 lead',
        'Team "Sales": 1 person, no lead',
        '1 person with an empty Team: they leave their team',
        '"engineering" is read as the team "Engineering"',
        'No lead in the file: Sales. A team that exists keeps the leads it has; a new one has nobody at level 1 until it gets one.',
      ],
    });
  });

  it("lists the rows of a team file Logbook couldn't use in any workspace", async () => {
    const { problems } = await check(
      'team.csv',
      'Name,Email,Team,Team lead',
      'Ada,ada@example.com,Engineering,yes',
      'Cleo,cleo@example.com,Sales,maybe',
      'Dan,dan,Sales,',
      'Ada,ADA@example.com,Sales,',
      'Eve,eve@example.com,,yes',
      'Fay,,Sales,',
    );

    expect(problems).toEqual([
      { row: 3, reason: 'Team lead must be yes or empty' },
      { row: 4, reason: '"dan" is not an email address' },
      { row: 5, reason: 'ADA@example.com is already on row 2' },
      { row: 6, reason: 'Eve is marked as lead but has no team' },
      { row: 7, reason: 'Row has no email' },
    ]);
  });

  it('checks the dates and counts of leave balances against today', async () => {
    const result = await check(
      'leave-balances.csv',
      'Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left',
      'Ada,ada@example.com,2021-04-15,2026-11-12,12,,2',
      'Bob,bob@example.com,,2026-11-12,12.3,,',
      'Cleo,cleo@example.com,,2027-01-01,5,,',
      'Dan,dan@example.com,2020-03-04,,,,',
      'Eve,eve@example.com,,2025-06-01,4,,',
      'Fay,fay@example.com,,,,,',
    );

    expect(result).toEqual({
      kind: 'balances',
      rows: 6,
      problems: [
        {
          row: 3,
          reason: 'Days left "12.3": Logbook counts whole and half days',
        },
        { row: 4, reason: 'Balance on 1 Jan 2027 is after today' },
        {
          row: 6,
          reason:
            "Balance on must fall in Eve's current vacation year, which starts 1 Jan 2026",
        },
      ],
      summary: [
        '1 balance to set',
        '2 contract starts to set',
        '1 row with no count and no contract start: nothing to set',
      ],
    });
  });

  it('checks the types, dates and overlaps of a leave history', async () => {
    const result = await check(
      'leave-history.csv',
      'Name;Email;Leave type;From;To;Comment',
      'Ada;ada@example.com;Annual leave;2026-05-04;2026-05-15;',
      'Ada;ada@example.com;Vacation;2026-06-01;2026-06-02;',
      'Ada;ada@example.com;sick_leave;2026-05-10;2026-05-11;',
      'Bob;bob@example.com;Other;2026-05-10;2026-05-01;',
      'Bob;bob@example.com;Bonus day;2026-07-01;2026-07-01;',
    );

    expect(result).toEqual({
      kind: 'history',
      rows: 5,
      problems: [
        {
          row: 3,
          reason:
            '"Vacation" is not a leave type (use Annual leave, Bonus day, Sick leave, Unpaid leave or Other)',
        },
        { row: 4, reason: 'overlaps row 2' },
        { row: 5, reason: 'To is before From' },
      ],
      summary: ['2 leaves to add for 2 people'],
    });
  });

  // As in Slack: its Leave type, From and To make it a history.
  it('takes a leave history with a Team column as a history', async () => {
    const result = await check(
      'history.csv',
      'Email,Team,Leave type,From,To',
      'ada@example.com,Engineering,Annual leave,2026-05-04,2026-05-15',
    );

    expect(result.kind).toBe('history');
  });

  it.each([
    ['notes.txt', 'The file name must end in .csv or .xlsx.', ['Email,Team']],
    [
      'people.csv',
      expect.stringContaining('Not a file Logbook reads.'),
      ['Name,Phone', 'Ada,123'],
    ],
    [
      'team.xlsx',
      "The file can't be read: save it as CSV or Excel and send it again.",
      ['Email,Team'],
    ],
  ])('refuses %s', async (name, refusal, lines) => {
    expect(await check(name, ...lines)).toEqual({
      kind: null,
      refusal,
      rows: 0,
      problems: [],
      summary: [],
    });
  });

  it('refuses a file over 1 MB', async () => {
    const result = await checkSetupFile(
      Buffer.alloc(1024 * 1024 + 1, 'a'),
      'team.csv',
      TODAY,
    );

    expect(result.refusal).toBe('The file is larger than 1 MB.');
  });
});

describe('checkFiles', () => {
  const files: Record<string, Buffer> = {
    'out/team-setup.csv': csv(
      'Name,Email,Team,Team lead',
      'Ada,ada@example.com,Engineering,yes',
    ),
    'out/leave-history.csv': csv(
      'Email,Leave type,From,To',
      'ada@example.com,Holiday,2026-05-04,2026-05-15',
    ),
  };

  const run = async (paths: string[]) => {
    const printed: string[] = [];
    const clean = await checkFiles(paths, {
      readFile: (path) => files[path],
      print: (line) => printed.push(line),
      today: TODAY,
    });

    return { clean, printed };
  };

  it('prints what each file holds and what Slack still has to check', async () => {
    const { clean, printed } = await run(['out/team-setup.csv']);

    expect(clean).toBe(true);
    expect(printed).toEqual([
      '✓ out/team-setup.csv: team file, 1 row, 1 usable',
      '    Team "Engineering": 1 person, 1 lead',
      expect.stringMatching(/^ {4}Not checked here: .*Slack workspace/),
    ]);
  });

  it('is not clean when a row is unusable or a file is missing', async () => {
    const { clean, printed } = await run([
      'out/team-setup.csv',
      'out/leave-history.csv',
      'out/missing.csv',
    ]);

    expect(clean).toBe(false);
    expect(printed).toEqual(
      expect.arrayContaining([
        '✗ out/leave-history.csv: leave history, 1 row, 0 usable',
        '    Row 2: "Holiday" is not a leave type (use Annual leave, Bonus day, Sick leave, Unpaid leave or Other)',
        '✗ out/missing.csv: No such file.',
      ]),
    );
  });

  it.each([[[]], [['--help']]])('shows the usage for %j', async (paths) => {
    await expect(run(paths)).rejects.toThrow('pnpm files:check <file.csv');
  });
});
