import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab } from './support/app-home';
import { Workbook } from 'exceljs';
import { dmOf } from './support/team-file';
import { actionIdsOf } from './support/tab-readers';
import {
  BALANCES_TEMPLATE_HEADER,
  balancesCsv,
  csvLines,
  HISTORY_TEMPLATE_HEADER,
  historyCsv,
  leaveFileTexts,
  rowsById,
  shareLeaveFile,
} from './support/leave-file';

const UNKNOWN_FILE =
  "❗️ I can't tell what this file is. A team file needs Email and Team columns; leave balances need Email and Days left, Working days left, Bonus days left or Contract start; a leave history needs Email, Leave type, From and To.";

describe('Leave file', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  const expectTemplatesTo = async (
    user: Tables<'users'>,
    since: number,
    balanceLines: string[],
  ) => {
    const files = t.slackApi.uploadedFiles(workspace.token, dmOf(user), {
      since,
    });

    expect(files.map(({ filename }) => filename)).toEqual([
      'leave-balances.csv',
      'leave-history.csv',
    ]);
    expect(csvLines(files[0].content)).toEqual([
      BALANCES_TEMPLATE_HEADER,
      ...balanceLines,
    ]);
    expect(csvLines(files[1].content)).toEqual([HISTORY_TEMPLATE_HEADER]);
  };

  it('HR gets both templates from People', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const team = await workspace.addTeam({ name: 'Backend' });
    const ann = await workspace.addUser({
      name: 'Ann Ames',
      team_id: team.id,
      contract_start_date: '2024-03-01',
    });
    const home = await openAppHomeTab(t, workspace, hr, [
      NavigationActionId.People,
    ]);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, hr, home, UsersTabViewActionId.ImportLeave)
      .expect(200);
    await t.idle();

    await expectTemplatesTo(hr, since, [
      `Ann Ames,${ann.email},2024-03-01,2026-06-17,,,`,
      `Hana HR,${hr.email},,2026-06-17,,,`,
    ]);
  });

  it('an admin gets them from the checklist', async () => {
    const admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
    const home = await openAppHomeTab(t, workspace, admin);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, admin, home, UsersTabViewActionId.ImportLeave)
      .expect(200);
    await t.idle();

    await expectTemplatesTo(admin, since, [
      `Ann Admin,${admin.email},,2026-06-17,,,`,
    ]);
  });

  it('a manager clicking Import leave gets nothing', async () => {
    const manager = await workspace.addUser({ role: UserRole.Manager });
    const home = await openAppHomeTab(t, workspace, manager);
    const since = t.slackApi.mark();

    // The button is not on a manager's Home, but Slack takes ids from the
    // client.
    await t.slack
      .interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: manager.slack_id },
        trigger_id: 'trigger-forged',
        container: { type: 'view' },
        view: { team_id: workspace.slackId, ...home },
        actions: [
          {
            type: 'button',
            action_id: UsersTabViewActionId.ImportLeave,
            block_id: 'forged',
          },
        ],
      })
      .expect(200);
    await t.idle();

    expect(
      t.slackApi.uploadedFiles(workspace.token, dmOf(manager), { since }),
    ).toEqual([]);
    expect(t.slackApi.calls.slice(since)).toEqual([]);
  });

  it('the old /upload-vacations command is gone', async () => {
    const admin = await workspace.addUser({ role: UserRole.Admin });

    await t.slack
      .command('/api/slack/admin/user-vacations-upload', workspace, admin)
      .expect(404);
    await t.idle();

    expect(t.slackApi.calls).not.toContainEqual(
      expect.objectContaining({ token: workspace.token }),
    );
  });

  // Today is Wednesday 2026-06-17 (TEST_NOW). Without a contract start the
  // vacation year is the calendar year: Anna's policy gives 26 days (20
  // working) and 3 bonus days, and she took 10 days (8 working) in March.
  describe('a preview', () => {
    let hr: Tables<'users'>;
    let team: Tables<'teams'>;
    let anna: Tables<'users'>;

    const addPerson = (name: string, fields: Partial<Tables<'users'>> = {}) =>
      workspace.addUser({
        name,
        team_id: team.id,
        created_at: '2026-01-01T09:00:00Z',
        ...fields,
      });

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
      const policy = await workspace.addVacationPolicy({
        vacation_days: 26,
        working_days: 20,
        carryover_days: 5,
        bonus_days: 3,
      });
      team = await workspace.addTeam({ vacation_policy_id: policy.id });
      anna = await addPerson('Anna Novak');
      await workspace.addVacationRequest(anna, {
        start_date: '2026-03-02',
        end_date: '2026-03-11',
        days: 10,
        working_days: 8,
      });
    });

    const share = (content: string | Buffer, fileName: string) =>
      shareLeaveFile(t, workspace, hr, content, fileName);
    const shareBalances = (...lines: string[]) =>
      share(balancesCsv(...lines), 'leave-balances.csv');
    const shareHistory = (...lines: string[]) =>
      share(historyCsv(...lines), 'leave-history.csv');
    const state = async () => ({
      users: await rowsById(workspace.rows('users')),
      requests: await rowsById(workspace.rows('vacation_requests')),
      balances: await rowsById(workspace.rows('leave_balances')),
    });

    it('of balances shows the corrections, the matches, the vacation year changes and the planned leave, and changes nothing', async () => {
      const [bo, cy, dee, eve] = await Promise.all(
        ['Bo Brown', 'Cy Clark', 'Dee Dunn', 'Eve Evans'].map((name) =>
          addPerson(name),
        ),
      );
      await workspace.addVacationRequest(anna, {
        start_date: '2026-07-06',
        end_date: '2026-07-10',
        days: 5,
        working_days: 5,
      });
      const before = await state();

      const [preview, ...others] = await shareBalances(
        `Anna Novak,${anna.email},,2026-06-17,12,,`,
        `Bo Brown,${bo.email},,,,20,`,
        `Cy Clark,${cy.email},2021-04-15,,,,`,
        `Dee Dunn,${dee.email},,2026-06-17,,,`,
        `Eve Evans,${eve.email},,2026-06-17,,,2`,
      );

      expect(others).toEqual([]);
      expect(preview.text).toBe("Here's what leave-balances.csv will do");
      expect(leaveFileTexts(preview)).toEqual([
        "*Here's what leave-balances.csv will do*",
        'Balances on *17 Jun 2026* for 3 people. Leave from that day on is taken from them as usual.',
        [
          "*Corrections (2)*: the file's balance differs from what Logbook counts",
          '• Anna Novak: 12 days left, Logbook counts 16 → correction -4',
          '• Eve Evans: 2 bonus days left, Logbook counts 3 → correction -1',
        ].join('\n'),
        '1 person matches what Logbook counts.',
        '*Vacation year changes (1)*: contract start set\n• Cy Clark: from 15 Apr (was 1 Jan)',
        '*Planned leave (1)*: already in Logbook, from the balance date on\n• Anna Novak: 12 left, 7 after 6–10 Jul 2026',
        '1 row changes nothing.',
      ]);
      expect(actionIdsOf(preview)).toEqual(['apply', 'cancel']);
      const [upload] = await workspace.rows('leave_file_uploads');
      expect(upload).toMatchObject({
        kind: 'balances',
        file_name: 'leave-balances.csv',
        status: 'previewed',
        uploaded_by: hr.id,
        message_channel: preview.channel,
        message_ts: preview.ts,
      });
      expect(await state()).toEqual(before);
    });

    it('of balances lists every row it can not use, with its reason', async () => {
      const [bo, cy, dee, eve, fay] = await Promise.all(
        ['Bo Brown', 'Cy Clark', 'Dee Dunn', 'Eve Evans', 'Fay Fox'].map(
          (name) => addPerson(name),
        ),
      );
      const gail = await addPerson('Gone Gail', { is_active: false });
      const before = await state();

      const [people] = await shareBalances(
        'Nobody,,,2026-06-17,12,,',
        'Nobody,nobody@example.test,,,12,,',
        `Gone Gail,${gail.email},,,12,,`,
        `Hana HR,${hr.email},,,12,,`,
        `Anna Novak,${anna.email},,,twelve,,`,
        `Anna Novak,${anna.email},,,12,,`,
      );
      const [values] = await shareBalances(
        `Bo Brown,${bo.email},,,12.3,,`,
        `Cy Clark,${cy.email},,2026-13-45,12,,`,
        `Dee Dunn,${dee.email},,2026-07-01,12,,`,
        `Eve Evans,${eve.email},,2025-12-01,12,,`,
        `Fay Fox,${fay.email},someday,,,,`,
      );

      expect(leaveFileTexts(people)).toEqual([
        'Nothing to change.',
        [
          "⚠️ *Rows it can't use (6)*",
          '• Row 2: Row has no email',
          "• Row 3: nobody@example.test isn't in this Slack workspace",
          '• Row 4: Gone Gail is deactivated',
          '• Row 5: Hana HR follows no vacation policy, so there is no balance to set. Set a policy first.',
          `• Row 6: Days left "twelve" isn't a number of days`,
          '• Row 7: Anna Novak is already on row 6',
        ].join('\n'),
      ]);
      expect(leaveFileTexts(values)).toEqual([
        'Nothing to change.',
        [
          "⚠️ *Rows it can't use (5)*",
          '• Row 2: Days left "12.3": Logbook counts whole and half days',
          `• Row 3: Balance on "2026-13-45" isn't a date: write it as 2026-11-12`,
          '• Row 4: Balance on 1 Jul 2026 is after today',
          "• Row 5: Balance on must fall in Eve Evans's current vacation year, which starts 1 Jan 2026",
          `• Row 6: Contract start "someday" isn't a date: write it as 2026-11-12`,
        ].join('\n'),
      ]);
      expect(actionIdsOf(people)).toEqual([]);
      expect(actionIdsOf(values)).toEqual([]);
      expect(await state()).toEqual(before);
    });

    it('of a history counts the leaves by type and from today on, and shows the balances they change, the planned leave, the skipped and the unusable rows', async () => {
      const bo = await addPerson('Bo Brown');
      // As a balances file set it.
      await t.db
        .insertInto('leave_balances')
        .values({
          slack_team_id: workspace.id,
          user_id: bo.id,
          balance_on: '2026-06-17',
          bonus_days_left: 2,
          set_by: hr.id,
        })
        .execute();
      const before = await state();

      const [preview] = await shareHistory(
        `Anna Novak,${anna.email},Annual leave,2026-04-06,2026-04-10,`,
        `Anna Novak,${anna.email},Sick leave,2026-06-17,2026-06-18,`,
        `Anna Novak,${anna.email},Annual leave,2026-03-02,2026-03-11,`,
        `Bo Brown,${bo.email},Bonus day,2026-07-03,2026-07-03,`,
        `Bo Brown,${bo.email},Unpaid leave,2026-02-02,2026-02-03,`,
        `Anna Novak,${anna.email},Annual leave,2026-03-10,2026-03-12,`,
      );

      expect(preview.text).toBe("Here's what leave-history.csv will do");
      expect(leaveFileTexts(preview)).toEqual([
        "*Here's what leave-history.csv will do*",
        'Adds *4 leaves* for 2 people as approved. Nobody is asked to approve them and nobody gets a message.',
        '1 annual leave, 1 bonus day, 1 sick leave, 1 unpaid leave. 2 of them are from today on.',
        '*Balances that change (1)*: people with no balance from a file\n• Anna Novak: 16 → 11 days left, 12 → 7 working days left',
        '*Planned leave (1)*: taken from a balance from a file\n• Bo Brown: 2 bonus days left, 1 after 3 Jul 2026',
        '*Already in Logbook (1)*: skipped',
        "⚠️ *Rows it can't use (1)*\n• Row 7: overlaps Anna Novak's annual leave 2–11 Mar 2026",
      ]);
      expect(actionIdsOf(preview)).toEqual(['apply', 'cancel']);
      expect(await state()).toEqual(before);
    });

    it('shows Slack markup in the file name, names and reasons escaped', async () => {
      const eve = await addPerson('Eve <!here> & Co');

      const [preview] = await share(
        balancesCsv(
          `Eve,${eve.email},,2026-06-17,12,,`,
          '<!channel>,x<!channel>@example.test,,,12,,',
        ),
        'leave <balances> & co.csv',
      );

      expect(preview.text).toBe(
        "Here's what leave &lt;balances&gt; &amp; co.csv will do",
      );
      expect(leaveFileTexts(preview)).toEqual([
        "*Here's what leave &lt;balances&gt; &amp; co.csv will do*",
        'Balances on *17 Jun 2026* for 1 person. Leave from that day on is taken from them as usual.',
        "*Corrections (1)*: the file's balance differs from what Logbook counts\n• Eve &lt;!here&gt; &amp; Co: 12 days left, Logbook counts 26 → correction -14",
        "⚠️ *Rows it can't use (1)*\n• Row 3: x&lt;!channel&gt;@example.test isn't in this Slack workspace",
      ]);
    });

    describe('of a file a spreadsheet saved', () => {
      const applyIt = async (content: string | Buffer, fileName: string) => {
        const [preview] = await share(content, fileName);
        await t.slack.actOnMessage(workspace, hr, preview, 'apply').expect(200);
        await t.idle();
      };
      const annaNow = async () => ({
        contractStart: (await workspace.row('users', anna.id))
          .contract_start_date,
        balances: (await workspace.rows('leave_balances')).map(
          ({ balance_on, days_left }) => ({ balance_on, days_left }),
        ),
      });

      it.each([
        ['US', '4/15/2021', '6/17/2026'],
        ['UK', '15/04/2021', '17/06/2026'],
      ])(
        'reads the slash dates of a balances template saved with %s dates',
        async (_, contractStart, balanceOn) => {
          await applyIt(
            balancesCsv(
              `Anna Novak,${anna.email},${contractStart},${balanceOn},12,,`,
            ),
            'leave-balances.csv',
          );

          expect(await annaNow()).toEqual({
            contractStart: '2021-04-15',
            balances: [{ balance_on: '2026-06-17', days_left: 12 }],
          });
        },
      );

      it('reads a ; file with a decimal comma', async () => {
        await applyIt(
          [
            'Name;Email;Contract start;Balance on;Days left;Working days left;Bonus days left',
            `Anna Novak;${anna.email};;17.06.2026;12,5;;`,
          ].join('\n'),
          'leave-balances.csv',
        );

        expect(await annaNow()).toEqual({
          contractStart: null,
          balances: [{ balance_on: '2026-06-17', days_left: 12.5 }],
        });
      });

      it('reads the date cells of an Excel file', async () => {
        const workbook = new Workbook();
        workbook.addWorksheet('Leave').addRows([
          ['Name', 'Email', 'Leave type', 'From', 'To', 'Comment'],
          [
            'Anna Novak',
            anna.email,
            'Annual leave',
            new Date(Date.UTC(2026, 3, 6)),
            new Date(Date.UTC(2026, 3, 10)),
            '',
          ],
        ]);

        await applyIt(
          Buffer.from(await workbook.xlsx.writeBuffer()),
          'leave-history.xlsx',
        );

        expect(
          (await workspace.rows('vacation_requests'))
            .map(({ start_date, end_date }) => [start_date, end_date])
            .sort(),
        ).toEqual([
          ['2026-03-02', '2026-03-11'],
          ['2026-04-06', '2026-04-10'],
        ]);
      });

      it('refuses the slash dates of a file that mixes day/month and month/day', async () => {
        const [preview] = await shareHistory(
          `Anna Novak,${anna.email},Sick leave,13/05/2026,2026-05-13,`,
          `Anna Novak,${anna.email},Sick leave,05/14/2026,2026-05-14,`,
          `Anna Novak,${anna.email},Sick leave,2026-05-15,2026-05-15,`,
        );

        expect(leaveFileTexts(preview).slice(-1)).toEqual([
          [
            "⚠️ *Rows it can't use (2)*",
            `• Row 2: From "13/05/2026": the file's dates with / mix day/month and month/day; write dates as 2026-11-12`,
            `• Row 3: From "05/14/2026": the file's dates with / mix day/month and month/day; write dates as 2026-11-12`,
          ].join('\n'),
        ]);
      });

      it('refuses a slash date that could be day/month or month/day', async () => {
        const [preview] = await shareHistory(
          `Anna Novak,${anna.email},Annual leave,5/4/2026,2026-05-06,`,
        );

        expect(leaveFileTexts(preview)).toEqual([
          'Nothing to change.',
          `⚠️ *Rows it can't use (1)*\n• Row 2: From "5/4/2026" could be day/month or month/day: write dates as 2026-11-12 or save the file as Excel`,
        ]);
      });
    });
  });

  describe('a file that is none of the three', () => {
    it('is told what each kind needs', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });

      const posted = await shareLeaveFile(
        t,
        workspace,
        hr,
        'Name,Mail\nAnna,anna@example.test\n',
        'people.csv',
      );

      expect(posted).toEqual([]);
      expect(
        t.slackApi
          .ephemeralMessages(workspace.token, hr.slack_id)
          .map(({ text }) => text),
      ).toEqual([UNKNOWN_FILE]);
      expect(await workspace.rows('leave_file_uploads')).toEqual([]);
    });
  });

  describe('who may share one', () => {
    it('an admin gets a preview', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      const [preview] = await shareLeaveFile(
        t,
        workspace,
        admin,
        historyCsv(
          `Anna Novak,${anna.email},Sick leave,2026-06-01,2026-06-02,`,
        ),
        'leave-history.csv',
      );

      expect(leaveFileTexts(preview)[0]).toBe(
        "*Here's what leave-history.csv will do*",
      );
    });

    it.each([UserRole.Manager, UserRole.Finance, UserRole.Member])(
      'a %s gets no preview, and nothing is kept',
      async (role) => {
        const sharer = await workspace.addUser({ role });
        const anna = await workspace.addUser({ name: 'Anna Novak' });

        const posted = await shareLeaveFile(
          t,
          workspace,
          sharer,
          historyCsv(
            `Anna Novak,${anna.email},Sick leave,2026-06-01,2026-06-02,`,
          ),
          'leave-history.csv',
        );

        expect(posted).toEqual([]);
        expect(t.slackApi.callsWith(workspace.token, 'files.download')).toEqual(
          [],
        );
        expect(await workspace.rows('leave_file_uploads')).toEqual([]);
        expect(await workspace.rows('vacation_requests')).toEqual([]);
      },
    );
  });
});
