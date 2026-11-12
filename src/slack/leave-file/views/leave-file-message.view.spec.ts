import VacationType from '@common/enums/vacation-type.enum';
import { VACATION_TYPE_LABELS } from '@modules/slack/common/views/data/labels';
import { LeaveFileMessageView } from '@modules/slack/leave-file/views/leave-file-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { LEAVE_FILE_TYPE_NAMES } from 'src/leave-file/constants/leave-file-type-names';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { ILeaveBalancesPlan } from 'src/leave-file/types/leave-balances-plan.interface';
import { ILeaveFilePreview } from 'src/leave-file/types/leave-file-apply-result.interface';
import { ILeaveHistoryPlan } from 'src/leave-file/types/leave-history-plan.interface';

const person = (id: string, name: string) =>
  ({
    id,
    name,
    email: `${id}@example.test`,
    is_active: true,
  }) as IUserViewModel;

const anna = person('anna', 'Anna Novak');
const bo = person('bo', 'Bo <!here>');
const kate = person('kate', 'Kate Moss');
const people = [anna, bo, kate];

const TODAY = '2026-11-12';
const balancesUpload = {
  id: 'upload-1',
  file_name: 'leave-balances.csv',
  plan_digest: 'digest-1',
};
const historyUpload = { ...balancesUpload, file_name: 'leave-history.csv' };

const CHANGED_SINCE_PREVIEW =
  "Logbook changed since this preview, so here's what the file will do now.";

type IBalance = ILeaveBalancesPlan['balances'][number];

const balance = (userId: string, fields: Partial<IBalance>): IBalance => ({
  userId,
  balanceOn: '2026-11-12',
  daysLeft: null,
  workingDaysLeft: null,
  bonusDaysLeft: null,
  counted: { days: 0, workingDays: 0, bonusDays: 0 },
  planned: [],
  after: { days: null, workingDays: null, bonusDays: null },
  ...fields,
});

const balancesPlan = (
  fields: Partial<ILeaveBalancesPlan> = {},
): ILeaveBalancesPlan => ({
  balances: [],
  contractStarts: [],
  unchanged: 0,
  unusable: [],
  ...fields,
});

const historyPlan = (
  fields: Partial<ILeaveHistoryPlan> = {},
): ILeaveHistoryPlan => ({
  add: [],
  skipped: 0,
  balanceChanges: [],
  plannedLeave: [],
  unusable: [],
  ...fields,
});

const balances = (
  plan: ILeaveBalancesPlan,
  who = people,
): ILeaveFilePreview => ({ kind: LeaveFileKind.Balances, plan, people: who });
const history = (plan: ILeaveHistoryPlan): ILeaveFilePreview => ({
  kind: LeaveFileKind.History,
  plan,
  people,
});

const section = (text: string) => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});
const context = (text: string) => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text }],
});
const button = (
  actionId: string,
  text: string,
  fields: Record<string, string> = {},
) => ({
  type: 'button',
  action_id: actionId,
  text: { type: 'plain_text', text },
  ...fields,
});

// Each block as its text; an actions block as its buttons' action IDs.
const textsOf = (message: { blocks: unknown[] }) =>
  (
    message.blocks as {
      type: string;
      text?: { text: string };
      elements: { text: string; action_id: string }[];
    }[]
  ).map((block) =>
    block.type === 'section'
      ? block.text!.text
      : block.type === 'context'
        ? block.elements[0].text
        : block.elements.map(({ action_id }) => action_id),
  );

const annualLeave = (startDate: string, endDate: string) => ({
  type: VacationType.AnnualLeave,
  startDate,
  endDate,
});
const bonusDay = (date: string) => ({
  type: VacationType.BonusDay,
  startDate: date,
  endDate: date,
});

describe('LeaveFileMessageView', () => {
  const view = new LeaveFileMessageView();

  it('names each leave type as Logbook does everywhere else', () => {
    for (const type of Object.values(VacationType)) {
      expect(LEAVE_FILE_TYPE_NAMES[type]).toBe(
        VACATION_TYPE_LABELS[type].label,
      );
    }
  });

  describe('a balances preview', () => {
    it('shows the date, corrections, matches, vacation year changes, planned leave and unusable rows, with Apply and Cancel', () => {
      const message = view.preview(
        balances(
          balancesPlan({
            balances: [
              balance('anna', {
                daysLeft: 12,
                counted: { days: 15, workingDays: 11, bonusDays: 3 },
                planned: [annualLeave('2026-12-21', '2026-12-31')],
                after: { days: 1, workingDays: null, bonusDays: null },
              }),
              balance('bo', {
                workingDaysLeft: 9,
                bonusDaysLeft: 2,
                counted: { days: 20, workingDays: 7, bonusDays: 3 },
                after: { days: null, workingDays: 9, bonusDays: 2 },
              }),
              balance('kate', {
                daysLeft: 10,
                counted: { days: 10, workingDays: 8, bonusDays: 3 },
                after: { days: 10, workingDays: null, bonusDays: null },
              }),
            ],
            contractStarts: [
              { userId: 'anna', before: null, after: '2021-04-15' },
              { userId: 'kate', before: '2019-03-01', after: '2020-03-01' },
            ],
            unchanged: 2,
            unusable: [
              {
                row: 7,
                reason: "nobody@example.test isn't in this Slack workspace",
              },
              { row: 8, reason: '<!channel> & Co is deactivated' },
            ],
          }),
        ),
        balancesUpload,
        TODAY,
      );

      expect(message).toEqual({
        text: "Here's what leave-balances.csv will do",
        blocks: [
          section("*Here's what leave-balances.csv will do*"),
          section(
            'Balances on *12 Nov 2026* for 3 people. Leave from that day on is taken from them as usual.',
          ),
          section(
            [
              "*Corrections (2)*: the file's balance differs from what Logbook counts",
              '• Anna Novak: 12 days left, Logbook counts 15 → correction -3',
              '• Bo &lt;!here&gt;: 9 working days left, Logbook counts 7 → correction +2; 2 bonus days left, Logbook counts 3 → correction -1',
            ].join('\n'),
          ),
          context('1 person matches what Logbook counts.'),
          section(
            [
              '*Vacation year changes (2)*: contract start set',
              '• Anna Novak: from 15 Apr (was 1 Jan)',
              '• Kate Moss: contract start 1 Mar 2020 (was 1 Mar 2019)',
            ].join('\n'),
          ),
          section(
            [
              '*Planned leave (1)*: already in Logbook, from the balance date on',
              '• Anna Novak: 12 left, 1 after 21–31 Dec 2026',
            ].join('\n'),
          ),
          section(
            [
              "⚠️ *Rows it can't use (2)*",
              "• Row 7: nobody@example.test isn't in this Slack workspace",
              '• Row 8: &lt;!channel&gt; &amp; Co is deactivated',
            ].join('\n'),
          ),
          context('2 rows change nothing.'),
          {
            type: 'actions',
            block_id: 'leave_file_message',
            elements: [
              button('apply', 'Apply', {
                style: 'primary',
                value: 'apply:upload-1:digest-1',
              }),
              button('cancel', 'Cancel', { value: 'cancel:upload-1' }),
            ],
          },
        ],
      });
    });

    it('says the dates are in the file when they differ, and leaves out the parts that are empty', () => {
      const message = view.preview(
        balances(
          balancesPlan({
            balances: [
              balance('anna', {
                daysLeft: 12.5,
                balanceOn: '2026-11-01',
                counted: { days: 12.5, workingDays: 0, bonusDays: 0 },
              }),
              balance('kate', {
                daysLeft: 1,
                counted: { days: 1, workingDays: 0, bonusDays: 0 },
              }),
            ],
            unchanged: 1,
          }),
        ),
        balancesUpload,
        TODAY,
      );

      expect(textsOf(message)).toEqual([
        "*Here's what leave-balances.csv will do*",
        'Balances for 2 people, on the dates in the file.',
        '2 people match what Logbook counts.',
        '1 row changes nothing.',
        ['apply', 'cancel'],
      ]);
    });

    it('shows only the vacation year changes of a file with only contract starts', () => {
      const message = view.preview(
        balances(
          balancesPlan({
            contractStarts: [
              { userId: 'anna', before: '2021-04-15', after: '2021-09-01' },
            ],
          }),
        ),
        balancesUpload,
        TODAY,
      );

      expect(textsOf(message)).toEqual([
        "*Here's what leave-balances.csv will do*",
        '*Vacation year changes (1)*: contract start set\n• Anna Novak: from 1 Sep (was 15 Apr)',
        ['apply', 'cancel'],
      ]);
    });

    it('says when a new contract start moves a balance from a file into the year before', () => {
      const message = view.preview(
        balances(
          balancesPlan({
            contractStarts: [
              {
                userId: 'anna',
                before: null,
                after: '2020-06-15',
                movedBalanceOn: '2026-06-10',
              },
            ],
          }),
        ),
        balancesUpload,
        TODAY,
      );

      expect(textsOf(message)[1]).toBe(
        [
          '*Vacation year changes (1)*: contract start set',
          '• Anna Novak: from 15 Jun (was 1 Jan). The balance of 10 Jun 2026 now falls in the year before and carries over.',
        ].join('\n'),
      );
    });

    it('lists planned leave per unit the leave takes from, with a negative balance and a single day', () => {
      const message = view.preview(
        balances(
          balancesPlan({
            balances: [
              balance('anna', {
                daysLeft: 12,
                workingDaysLeft: 9,
                bonusDaysLeft: 2,
                counted: { days: 12, workingDays: 9, bonusDays: 2 },
                planned: [
                  bonusDay('2026-12-04'),
                  annualLeave('2026-12-21', '2026-12-31'),
                ],
                after: { days: 1, workingDays: 4, bonusDays: 1 },
              }),
              balance('kate', {
                bonusDaysLeft: 1,
                counted: { days: 0, workingDays: 0, bonusDays: 1 },
                planned: [bonusDay('2026-12-04'), bonusDay('2026-12-07')],
                after: { days: null, workingDays: null, bonusDays: -1 },
              }),
              // Annual leave takes nothing from a balance of bonus days only.
              balance('bo', {
                bonusDaysLeft: 2,
                counted: { days: 0, workingDays: 0, bonusDays: 2 },
                planned: [annualLeave('2026-12-21', '2026-12-31')],
                after: { days: null, workingDays: null, bonusDays: 2 },
              }),
            ],
          }),
        ),
        balancesUpload,
        TODAY,
      );

      expect(textsOf(message)[3]).toBe(
        [
          '*Planned leave (2)*: already in Logbook, from the balance date on',
          '• Anna Novak: 12 left, 1 after 21–31 Dec 2026; 9 working days left, 4 after 21–31 Dec 2026; 2 bonus days left, 1 after 4 Dec 2026',
          '• Kate Moss: 1 bonus day left, -1 after 4 Dec 2026, 7 Dec 2026',
        ].join('\n'),
      );
    });

    it('says when nothing changes, and lists the unusable rows then', () => {
      expect(
        view.preview(
          balances(balancesPlan({ unchanged: 3 })),
          balancesUpload,
          TODAY,
        ),
      ).toEqual({
        text: 'Nothing to change: everything in the file is already in Logbook.',
        blocks: [
          section(
            'Nothing to change: everything in the file is already in Logbook.',
          ),
        ],
      });
      expect(
        textsOf(
          view.preview(
            balances(
              balancesPlan({
                unusable: [{ row: 2, reason: 'Row has no email' }],
              }),
            ),
            balancesUpload,
            TODAY,
          ),
        ),
      ).toEqual([
        'Nothing to change.',
        "⚠️ *Rows it can't use (1)*\n• Row 2: Row has no email",
      ]);
    });

    it('keeps a list of 200 people within 50 blocks and 3000 characters a section', () => {
      const many = Array.from({ length: 200 }, (_, i) =>
        person(`p${i}`, `${'Very long name '.repeat(8)}${i}`),
      );
      const message = view.preview(
        balances(
          balancesPlan({
            balances: many.map(({ id }) =>
              balance(id, {
                daysLeft: 12,
                workingDaysLeft: 9,
                counted: { days: 15, workingDays: 7, bonusDays: 3 },
                planned: [annualLeave('2026-12-21', '2026-12-31')],
                after: { days: 1, workingDays: 4, bonusDays: null },
              }),
            ),
            contractStarts: many.map(({ id }) => ({
              userId: id,
              before: null,
              after: '2021-04-15',
            })),
            unusable: many.map((_, i) => ({
              row: i + 2,
              reason: 'x'.repeat(300),
            })),
          }),
          many,
        ),
        balancesUpload,
        TODAY,
      );
      const texts = textsOf(message).filter(
        (text): text is string => typeof text === 'string',
      );

      expect(message.blocks.length).toBeLessThanOrEqual(50);
      for (const text of texts) {
        expect(text.length).toBeLessThanOrEqual(3000);
      }
      expect(texts[2]).toMatch(/\n…and 19\d more$/);
      expect(texts[3]).toMatch(/\n…and 190 more$/);
      expect(texts[4]).toMatch(/\n…and 19\d more$/);
      expect(texts[5]).toMatch(/\n…and 19\d more$/);
    });
  });

  describe('a history preview', () => {
    const plan = historyPlan({
      add: [
        {
          row: 2,
          userId: 'anna',
          ...annualLeave('2026-03-02', '2026-03-06'),
          comment: null,
        },
        {
          row: 3,
          userId: 'anna',
          type: VacationType.SickLeave,
          startDate: '2026-11-12',
          endDate: '2026-11-13',
          comment: null,
        },
        {
          row: 4,
          userId: 'kate',
          ...bonusDay('2026-12-04'),
          comment: 'Agreed',
        },
        { row: 5, userId: 'kate', ...bonusDay('2026-10-01'), comment: null },
        {
          row: 6,
          userId: 'bo',
          type: VacationType.UnpaidLeave,
          startDate: '2026-11-11',
          endDate: '2026-11-12',
          comment: null,
        },
      ],
      skipped: 4,
      balanceChanges: [
        {
          userId: 'anna',
          before: { days: 26, workingDays: 20, bonusDays: 3 },
          after: { days: 21, workingDays: 15, bonusDays: 3 },
        },
      ],
      plannedLeave: [
        {
          userId: 'kate',
          balanceOn: '2026-11-12',
          leave: [bonusDay('2026-12-04')],
          left: { days: 10, workingDays: null, bonusDays: 2 },
          after: { days: 10, workingDays: null, bonusDays: 1 },
        },
      ],
      unusable: [{ row: 9, reason: 'overlaps row 2' }],
    });

    it('counts the leaves by type and from today on, and shows the balances they change, the skipped and the unusable rows', () => {
      const message = view.preview(history(plan), historyUpload, TODAY);

      expect(message.text).toBe("Here's what leave-history.csv will do");
      expect(textsOf(message)).toEqual([
        "*Here's what leave-history.csv will do*",
        'Adds *5 leaves* for 3 people as approved. Nobody is asked to approve them and nobody gets a message.',
        '1 annual leave, 2 bonus days, 1 sick leave, 1 unpaid leave. 3 of them are from today on.',
        '*Balances that change (1)*: people with no balance from a file\n• Anna Novak: 26 → 21 days left, 20 → 15 working days left',
        '*Planned leave (1)*: taken from a balance from a file\n• Kate Moss: 2 bonus days left, 1 after 4 Dec 2026',
        '*Already in Logbook (4)*: skipped',
        "⚠️ *Rows it can't use (1)*\n• Row 9: overlaps row 2",
        ['apply', 'cancel'],
      ]);
    });

    it('counts one leave, past only, and other leave', () => {
      expect(
        textsOf(
          view.preview(
            history(
              historyPlan({
                add: [
                  {
                    row: 2,
                    userId: 'anna',
                    type: VacationType.Other,
                    startDate: '2026-03-02',
                    endDate: '2026-03-02',
                    comment: null,
                  },
                ],
              }),
            ),
            historyUpload,
            TODAY,
          ),
        ).slice(1, 3),
      ).toEqual([
        'Adds *1 leave* for 1 person as approved. Nobody is asked to approve them and nobody gets a message.',
        '1 other.',
      ]);
    });

    it('says when everything is already in Logbook', () => {
      expect(
        textsOf(
          view.preview(
            history(historyPlan({ skipped: 3 })),
            historyUpload,
            TODAY,
          ),
        ),
      ).toEqual([
        'Nothing to change: everything in the file is already in Logbook.',
      ]);
    });
  });

  describe('a preview Logbook changed since', () => {
    it('says so above what the file will do now, with Apply carrying the new digest', () => {
      const message = view.changedPreview(
        history(
          historyPlan({
            add: [
              {
                row: 2,
                userId: 'anna',
                ...annualLeave('2026-03-02', '2026-03-06'),
                comment: null,
              },
            ],
          }),
        ),
        { ...historyUpload, plan_digest: 'digest-2' },
        TODAY,
      );

      expect(message.text).toBe(CHANGED_SINCE_PREVIEW);
      expect(textsOf(message)).toEqual([
        CHANGED_SINCE_PREVIEW,
        'Adds *1 leave* for 1 person as approved. Nobody is asked to approve them and nobody gets a message.',
        '1 annual leave.',
        ['apply', 'cancel'],
      ]);
      expect(message.blocks[message.blocks.length - 1]).toMatchObject({
        elements: [{ value: 'apply:upload-1:digest-2' }, {}],
      });
    });

    it('says so above nothing to change', () => {
      expect(
        textsOf(
          view.changedPreview(history(historyPlan()), historyUpload, TODAY),
        ),
      ).toEqual([
        CHANGED_SINCE_PREVIEW,
        'Nothing to change: everything in the file is already in Logbook.',
      ]);
    });
  });

  describe('the result', () => {
    it('of balances counts them, the contract starts and the rows left out, with Open People and Undo', () => {
      const message = view.applied(
        balances(
          balancesPlan({
            balances: [
              balance('anna', {}),
              balance('bo', {}),
              balance('kate', {}),
            ],
            contractStarts: [
              { userId: 'anna', before: null, after: '2021-04-15' },
            ],
            unusable: [
              { row: 7, reason: 'Row has no email' },
              { row: 8, reason: '<b>' },
            ],
          }),
        ),
        'upload-1',
      );

      expect(message).toEqual({
        text: "✅ Set balances for 3 people. Changed the contract start of 1 person. 2 rows weren't used.",
        blocks: [
          section(
            "✅ Set balances for 3 people. Changed the contract start of 1 person. 2 rows weren't used.",
          ),
          section(
            "⚠️ *Rows it didn't use (2)*\n• Row 7: Row has no email\n• Row 8: &lt;b&gt;",
          ),
          {
            type: 'actions',
            block_id: 'leave_file_message',
            elements: [
              button('nav_people', 'Open People'),
              button('undo', 'Undo', { value: 'undo:upload-1' }),
            ],
          },
        ],
      });
    });

    it('of contract starts only says only that', () => {
      expect(
        view.applied(
          balances(
            balancesPlan({
              contractStarts: [
                { userId: 'anna', before: null, after: '2021-04-15' },
                { userId: 'bo', before: null, after: '2021-04-15' },
              ],
            }),
          ),
          'upload-1',
        ).text,
      ).toBe('✅ Changed the contract start of 2 people.');
    });

    it('of a history counts the leaves and their people, with Open Time off and Undo', () => {
      const message = view.applied(
        history(
          historyPlan({
            add: [
              {
                row: 2,
                userId: 'anna',
                ...annualLeave('2026-03-02', '2026-03-06'),
                comment: null,
              },
              {
                row: 3,
                userId: 'anna',
                ...bonusDay('2026-10-01'),
                comment: null,
              },
              {
                row: 4,
                userId: 'kate',
                ...bonusDay('2026-10-02'),
                comment: null,
              },
            ],
            unusable: [{ row: 5, reason: 'overlaps row 2' }],
          }),
        ),
        'upload-1',
      );

      expect(message.text).toBe(
        "✅ Added 3 leaves for 2 people. 1 row wasn't used.",
      );
      expect(textsOf(message)).toEqual([
        "✅ Added 3 leaves for 2 people. 1 row wasn't used.",
        "⚠️ *Rows it didn't use (1)*\n• Row 5: overlaps row 2",
        ['nav_time_off', 'undo'],
      ]);
    });
  });

  describe('closed previews', () => {
    it.each([
      [LeaveFileUploadStatus.Canceled, 'Canceled. Nothing changed.'],
      [
        LeaveFileUploadStatus.Superseded,
        'A newer file replaced this one. Nothing changed.',
      ],
      ['expired' as const, 'This preview has expired. Send the file again.'],
    ])('%s says so, with no buttons', (status, text) => {
      expect(view.closed(status)).toEqual({ text, blocks: [section(text)] });
    });

    it.each([LeaveFileUploadStatus.Applied, LeaveFileUploadStatus.Undone])(
      '%s leaves the message as it is',
      (status) => expect(view.closed(status)).toBeNull(),
    );

    it('Cancel says nothing changed', () =>
      expect(view.canceled()).toEqual({
        text: 'Canceled. Nothing changed.',
        blocks: [section('Canceled. Nothing changed.')],
      }));
  });

  describe('undone', () => {
    it('says only the count when nothing was kept', () =>
      expect(view.undone(2, [])).toEqual({
        text: '↩️ Undone: 2 changes restored.',
        blocks: [section('↩️ Undone: 2 changes restored.')],
      }));

    it('names what it kept, escaped', () =>
      expect(
        view.undone(1, [
          "Anna Novak's annual leave 2–6 Mar 2026",
          "<!here>'s balance",
        ]),
      ).toEqual({
        text: '↩️ Undone: 1 change restored.',
        blocks: [
          section(
            [
              '↩️ Undone: 1 change restored.',
              'Kept, because they changed since:',
              "• Anna Novak's annual leave 2–6 Mar 2026",
              "• &lt;!here&gt;'s balance",
            ].join('\n'),
          ),
        ],
      }));
  });
});
