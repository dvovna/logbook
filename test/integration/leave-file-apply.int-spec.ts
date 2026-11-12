import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { SETUP_BLOCK_ID } from '@modules/slack/tabs/home/views/home-tab.view';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { SlackJson } from './support/block-kit';
import { IPostedMessage } from './support/fake-slack-api.client';
import { actionIdsOf, sectionTexts } from './support/tab-readers';
import { travelTo } from './support/clock';
import { clickInMessage } from './support/team-file';
import {
  balancesCsv,
  historyCsv,
  leaveFileTexts,
  rowsById,
  shareLeaveFile,
} from './support/leave-file';

const CHANGED_SINCE_PREVIEW =
  "Logbook changed since this preview, so here's what the file will do now.";

// Today is Wednesday 2026-06-17 (TEST_NOW). Without a contract start the
// vacation year is the calendar year: Anna's policy gives 26 days (20
// working) and 3 bonus days, and she took 10 days (8 working) in March.
describe('Leave file Apply', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let team: Tables<'teams'>;
  let anna: Tables<'users'>;
  let march: Tables<'vacation_requests'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const policy = await workspace.addVacationPolicy({
      vacation_days: 26,
      working_days: 20,
      carryover_days: 5,
      bonus_days: 3,
    });
    team = await workspace.addTeam({ vacation_policy_id: policy.id });
    anna = await workspace.addUser({
      name: 'Anna Novak',
      team_id: team.id,
      created_at: '2026-01-01T09:00:00Z',
    });
    march = await workspace.addVacationRequest(anna, {
      start_date: '2026-03-02',
      end_date: '2026-03-11',
      days: 10,
      working_days: 8,
    });
  });

  const share = (content: string, fileName: string, user = hr) =>
    shareLeaveFile(t, workspace, user, content, fileName);
  const shareBalances = (...lines: string[]) =>
    share(balancesCsv(...lines), 'leave-balances.csv');
  const shareHistory = (...lines: string[]) =>
    share(historyCsv(...lines), 'leave-history.csv');
  const click = (message: IPostedMessage, action: string, user = hr) =>
    clickInMessage(t, workspace, user, message, action);
  // Shares and applies a file; returns the preview message carrying the
  // result's blocks.
  const apply = async (shared: Promise<IPostedMessage[]>) => {
    const [preview] = await shared;
    const result = await click(preview, 'apply');

    return { ...preview, blocks: result!.blocks as IPostedMessage['blocks'] };
  };
  const annualLeaveOnHome = async (user = anna) =>
    sectionTexts(await openAppHomeTab(t, workspace, user)).find((text) =>
      text.startsWith('Annual leave:'),
    );
  const uploads = () => workspace.rows('leave_file_uploads');
  const imported = async () =>
    (await workspace.rows('vacation_requests'))
      .filter(({ leave_file_upload_id }) => leave_file_upload_id)
      .map(({ type, start_date, end_date }) => ({ type, start_date, end_date }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

  describe('a balances file', () => {
    it('sets the balance Home shows, which the next year carries over from', async () => {
      const [preview] = await shareBalances(
        `Anna Novak,${anna.email},,2026-06-17,3,,`,
      );

      const result = await click(preview, 'apply');

      expect(result!.text).toBe('✅ Set balances for 1 person.');
      expect(leaveFileTexts(result)).toEqual(['✅ Set balances for 1 person.']);
      expect(actionIdsOf(result!)).toEqual([NavigationActionId.People, 'undo']);
      const [upload] = await uploads();
      expect(upload).toMatchObject({
        status: 'applied',
        applied_at: expect.any(String),
      });
      expect(
        (await workspace.rows('leave_balances')).map(
          ({
            user_id,
            balance_on,
            days_left,
            working_days_left,
            bonus_days_left,
            upload_id,
            set_by,
          }) => ({
            user_id,
            balance_on,
            days_left,
            working_days_left,
            bonus_days_left,
            upload_id,
            set_by,
          }),
        ),
      ).toEqual([
        {
          user_id: anna.id,
          balance_on: '2026-06-17',
          days_left: 3,
          working_days_left: null,
          bonus_days_left: null,
          upload_id: upload.id,
          set_by: hr.id,
        },
      ]);
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *3 available* / 26 total (*10* used, *8* working, *-13* correction)',
      );

      travelTo('2027-03-01');

      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *29 available* / 26 total (+*3* carryover)',
      );
    });

    it("a fresh template the next day with only bonus days keeps the day before's days left, less that day's leave", async () => {
      await workspace.addVacationRequest(anna, {
        start_date: '2026-06-17',
        end_date: '2026-06-17',
        days: 1,
        working_days: 1,
      });
      await apply(shareBalances(`Anna Novak,${anna.email},,2026-06-17,12,,`));
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *11 available* / 26 total (*11* used, *9* working, *-4* correction)',
      );

      travelTo('2026-06-18');
      const [preview] = await shareBalances(
        `Anna Novak,${anna.email},,2026-06-18,,,2`,
      );

      expect(leaveFileTexts(preview).slice(1)).toEqual([
        'Balances on *18 Jun 2026* for 1 person. Leave from that day on is taken from them as usual.',
        "*Corrections (1)*: the file's balance differs from what Logbook counts\n• Anna Novak: 11 days left, Logbook counts 15 → correction -4; 2 bonus days left, Logbook counts 3 → correction -1",
      ]);

      await click(preview, 'apply');

      expect(
        (await workspace.rows('leave_balances')).map(
          ({ balance_on, days_left, working_days_left, bonus_days_left }) => ({
            balance_on,
            days_left,
            working_days_left,
            bonus_days_left,
          }),
        ),
      ).toEqual([
        {
          balance_on: '2026-06-18',
          days_left: 11,
          working_days_left: null,
          bonus_days_left: 2,
        },
      ]);
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *11 available* / 26 total (*11* used, *9* working, *-4* correction)',
      );
      expect(
        sectionTexts(await openAppHomeTab(t, workspace, anna)).find((text) =>
          text.startsWith('Bonus days:'),
        ),
      ).toBe('Bonus days: *2 available* / 3 total (*-1* correction)');
    });

    it('a file of the next vacation year says which earlier balances go', async () => {
      await apply(shareBalances(`Anna Novak,${anna.email},,2026-06-17,12,,`));

      travelTo('2027-01-04');
      const [preview] = await shareBalances(
        `Anna Novak,${anna.email},,2027-01-04,,,2`,
      );

      expect(leaveFileTexts(preview).slice(1, 4)).toEqual([
        'Balances on *4 Jan 2027* for 1 person. Leave from that day on is taken from them as usual.',
        "*Corrections (1)*: the file's balance differs from what Logbook counts\n• Anna Novak: 2 bonus days left, Logbook counts 3 → correction -1",
        "*Earlier balances that go (1)*: the file's date replaces them\n• Anna Novak: 12 days left on 17 Jun 2026 (fill Days left to keep a balance)",
      ]);
    });

    it("the result's Open People shows People", async () => {
      const applied = await apply(
        shareBalances(`Anna Novak,${anna.email},,2026-06-17,3,,`),
      );
      const since = t.slackApi.mark();

      await t.slack
        .actOnMessage(workspace, hr, applied, NavigationActionId.People)
        .expect(200);

      expect((await publishedHome(t, workspace, hr, since)).callback_id).toBe(
        ViewCallbackId.UsersTabView,
      );
    });

    it('with a history after it, leave before its date changes only the correction, and leave after it is listed with what it leaves', async () => {
      await apply(shareBalances(`Anna Novak,${anna.email},,2026-06-17,12,,`));
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *12 available* / 26 total (*10* used, *8* working, *-4* correction)',
      );

      const [history] = await shareHistory(
        `Anna Novak,${anna.email},Annual leave,2026-04-06,2026-04-10,`,
        `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
      );

      expect(leaveFileTexts(history)).toEqual([
        "*Here's what leave-history.csv will do*",
        'Adds *2 leaves* for 1 person as approved. Nobody is asked to approve them and nobody gets a message.',
        '2 annual leave. 1 of them is from today on.',
        '*Planned leave (1)*: taken from a balance from a file\n• Anna Novak: 12 left, 7 after 6–10 Jul 2026',
      ]);

      const result = await click(history, 'apply');

      expect(leaveFileTexts(result)).toEqual([
        '✅ Added 2 leaves for 1 person.',
      ]);
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *7 available* / 26 total (*20* used, *18* working, *+1* correction)',
      );
    });

    it('a later file with only a contract start moves the balance into the year that now holds its date, which carries it over', async () => {
      await apply(shareBalances(`Anna Novak,${anna.email},,2026-06-10,3,,`));

      const [second] = await shareBalances(
        `Anna Novak,${anna.email},2020-06-15,,,,`,
      );

      expect(leaveFileTexts(second)).toEqual([
        "*Here's what leave-balances.csv will do*",
        '*Vacation year changes (1)*: contract start set\n• Anna Novak: from 15 Jun (was 1 Jan). The balance of 10 Jun 2026 now falls in the year before and carries over.',
      ]);

      const result = await click(second, 'apply');

      expect(leaveFileTexts(result)).toEqual([
        '✅ Changed the contract start of 1 person.',
      ]);
      expect((await workspace.row('users', anna.id)).contract_start_date).toBe(
        '2020-06-15',
      );
      // Its year ran from 15 Jun 2025: 3 left on 10 Jun, of which nothing
      // was taken before the 15th.
      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *29 available* / 26 total (+*3* carryover)',
      );
    });
  });

  describe('a history file', () => {
    it('adds its leaves as approved, with no workflow, no message and no time off offer, and keeps the comment', async () => {
      const lead = await workspace.addUser({ role: UserRole.Manager });
      await t.db
        .updateTable('teams')
        .set({ manager_approvers: [lead.slack_id] })
        .where('id', '=', team.id)
        .execute();
      const vacations = await workspace.addProject({ name: 'Vacations' });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: 'annual_leave',
          project_id: vacations.id,
        })
        .execute();
      const [preview] = await shareHistory(
        `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,Agreed by email`,
        `Anna Novak,${anna.email},Sick leave,2026-04-06,2026-04-07,`,
      );
      const since = t.slackApi.mark();

      const result = await click(preview, 'apply');
      await t.retryJobs();
      await t.idle();

      expect(result!.text).toBe('✅ Added 2 leaves for 1 person.');
      expect(actionIdsOf(result!)).toEqual([
        NavigationActionId.TimeOff,
        'undo',
      ]);
      const [upload] = await uploads();
      expect(
        (await workspace.rows('vacation_requests'))
          .filter(({ id }) => id !== march.id)
          .map((request) => ({
            type: request.type,
            start_date: request.start_date,
            end_date: request.end_date,
            days: request.days,
            working_days: request.working_days,
            status: request.status,
            team_id: request.team_id,
            user_comment: request.user_comment,
            created_by: request.created_by,
            leave_file_upload_id: request.leave_file_upload_id,
          }))
          .sort((a, b) => a.start_date.localeCompare(b.start_date)),
      ).toEqual([
        {
          type: 'sick_leave',
          start_date: '2026-04-06',
          end_date: '2026-04-07',
          days: 2,
          working_days: 2,
          status: 'approved',
          team_id: team.id,
          user_comment: null,
          created_by: hr.id,
          leave_file_upload_id: upload.id,
        },
        {
          type: 'annual_leave',
          start_date: '2026-07-06',
          end_date: '2026-07-10',
          days: 5,
          working_days: 5,
          status: 'approved',
          team_id: team.id,
          user_comment: 'Agreed by email',
          created_by: hr.id,
          leave_file_upload_id: upload.id,
        },
      ]);
      expect(await workspace.rows('request_workflow_steps')).toEqual([]);
      expect(
        t.slackApi.callsWith(workspace.token, 'chat.postMessage', { since }),
      ).toEqual([]);
      expect(
        t.slackApi.callsWith(workspace.token, 'chat.postEphemeral', { since }),
      ).toEqual([]);
      expect(await workspace.rows('time_entries')).toEqual([]);
    });

    it('a second upload of the same file adds nothing', async () => {
      const file = [
        `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
      ];
      await apply(shareHistory(...file));

      const [again] = await shareHistory(...file);

      expect(leaveFileTexts(again)).toEqual([
        'Nothing to change: everything in the file is already in Logbook.',
      ]);
      expect(actionIdsOf(again)).toEqual([]);
      expect(await imported()).toEqual([
        {
          type: 'annual_leave',
          start_date: '2026-07-06',
          end_date: '2026-07-10',
        },
      ]);
    });

    it('a leave overlapping a request made in Logbook is not used, and the request stays as it is', async () => {
      const [preview] = await shareHistory(
        `Anna Novak,${anna.email},Annual leave,2026-03-09,2026-03-13,`,
        `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
      );

      const result = await click(preview, 'apply');

      expect(leaveFileTexts(result)).toEqual([
        "✅ Added 1 leave for 1 person. 1 row wasn't used.",
        "⚠️ *Rows it didn't use (1)*\n• Row 2: overlaps Anna Novak's annual leave 2–11 Mar 2026",
      ]);
      expect(await workspace.row('vacation_requests', march.id)).toEqual(march);
      expect(await imported()).toEqual([
        {
          type: 'sick_leave',
          start_date: '2026-05-04',
          end_date: '2026-05-05',
        },
      ]);
    });

    it('adds no leave past the most requests a person may have, of any status', async () => {
      // With March, 499.
      await t.db
        .insertInto('vacation_requests')
        .values(
          Array.from({ length: 498 }, () => ({
            slack_team_id: workspace.id,
            user_id: anna.id,
            team_id: team.id,
            created_by: anna.id,
            type: 'annual_leave',
            status: 'canceled',
            start_date: '2025-02-03',
            end_date: '2025-02-03',
            days: 1,
            working_days: 1,
          })),
        )
        .execute();

      const [preview] = await shareHistory(
        `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
        `Anna Novak,${anna.email},Annual leave,2026-08-03,2026-08-07,`,
      );

      expect(leaveFileTexts(preview)).toContain(
        "⚠️ *Rows it can't use (1)*\n• Row 3: Anna Novak would have more than 500 requests",
      );

      await click(preview, 'apply');

      expect(await imported()).toEqual([
        {
          type: 'annual_leave',
          start_date: '2026-07-06',
          end_date: '2026-07-10',
        },
      ]);
    });

    it("future leave shows in Who's off next, and its details say where it came from", async () => {
      const applied = await apply(
        shareHistory(
          `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,Agreed by email`,
        ),
      );
      const [july] = (await workspace.rows('vacation_requests')).filter(
        ({ id }) => id !== march.id,
      );

      expect(
        sectionTexts(
          await openAppHomeTab(t, workspace, hr, [NavigationActionId.TimeOff]),
        ).find((text) => text.startsWith("*🟢 Who's off next*")),
      ).toBe("*🟢 Who's off next*\n• *Anna Novak* · 6–10 Jul 2026");

      const details = await openModalFrom(
        t,
        workspace,
        anna,
        await openAppHomeTab(t, workspace, anna, [NavigationActionId.TimeOff]),
        VacationHistoryTabViewActionId.ManageRequestMenu,
        `${VacationHistoryTabViewActionId.ViewDetails}:${july.id}`,
      );

      expect(sectionTexts(details)).toEqual([
        '💬 *User comment:*\nAgreed by email',
        '*🕒 Approval Timeline:*',
        'Imported from leave-history.csv by Hana HR on 17 Jun 2026',
        '_No approver comments yet._',
      ]);

      const since = t.slackApi.mark();
      await t.slack
        .actOnMessage(workspace, hr, applied, NavigationActionId.TimeOff)
        .expect(200);

      expect((await publishedHome(t, workspace, hr, since)).callback_id).toBe(
        ViewCallbackId.VacationHistoryTabView,
      );
    });

    it('a balances file after it gives the same balance as one before it', async () => {
      await apply(
        shareHistory(
          `Anna Novak,${anna.email},Annual leave,2026-04-06,2026-04-10,`,
          `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
        ),
      );

      const [preview] = await shareBalances(
        `Anna Novak,${anna.email},,2026-06-17,12,,`,
      );

      expect(leaveFileTexts(preview).slice(2)).toEqual([
        "*Corrections (1)*: the file's balance differs from what Logbook counts\n• Anna Novak: 12 days left, Logbook counts 11 → correction +1",
        '*Planned leave (1)*: already in Logbook, from the balance date on\n• Anna Novak: 12 left, 7 after 6–10 Jul 2026',
      ]);

      await click(preview, 'apply');

      expect(await annualLeaveOnHome()).toBe(
        'Annual leave: *7 available* / 26 total (*20* used, *18* working, *+1* correction)',
      );
    });
  });

  describe('between the preview and Apply', () => {
    const lines = () => [
      `Anna Novak,${anna.email},Annual leave,2026-07-06,2026-07-10,`,
      `Anna Novak,${anna.email},Annual leave,2026-08-03,2026-08-07,`,
    ];

    it('a request made in Logbook gets a new preview, whose Apply works', async () => {
      const [preview] = await shareHistory(...lines());
      const [shown] = await uploads();
      await workspace.addVacationRequest(anna, {
        start_date: '2026-07-08',
        end_date: '2026-07-08',
      });

      const update = await click(preview, 'apply');

      expect(update!.text).toBe(CHANGED_SINCE_PREVIEW);
      expect(leaveFileTexts(update)).toEqual([
        CHANGED_SINCE_PREVIEW,
        'Adds *1 leave* for 1 person as approved. Nobody is asked to approve them and nobody gets a message.',
        '1 annual leave. 1 of them is from today on.',
        '*Balances that change (1)*: people with no balance from a file\n• Anna Novak: 15 → 10 days left, 11 → 6 working days left',
        "⚠️ *Rows it can't use (1)*\n• Row 2: overlaps Anna Novak's annual leave 8 Jul 2026",
      ]);
      expect(actionIdsOf(update!)).toEqual(['apply', 'cancel']);
      expect(await imported()).toEqual([]);
      const [upload] = await uploads();
      expect(upload.status).toBe('previewed');
      expect(upload.plan_digest).not.toBe(shown.plan_digest);

      const result = await click(
        { ...preview, blocks: update!.blocks as IPostedMessage['blocks'] },
        'apply',
      );

      expect(leaveFileTexts(result)[0]).toBe(
        "✅ Added 1 leave for 1 person. 1 row wasn't used.",
      );
      expect(await imported()).toEqual([
        {
          type: 'annual_leave',
          start_date: '2026-08-03',
          end_date: '2026-08-07',
        },
      ]);
    });

    it('two clicks on Apply at once add the leaves once', async () => {
      const [preview] = await shareHistory(...lines());

      await Promise.all(
        [1, 2].map(() =>
          t.slack.actOnMessage(workspace, hr, preview, 'apply').expect(200),
        ),
      );
      await t.idle();

      const [update, ...others] = t.slackApi.messageUpdates(
        workspace.token,
        preview,
      );
      expect(others).toEqual([]);
      expect(leaveFileTexts(update)).toEqual([
        '✅ Added 2 leaves for 1 person.',
      ]);
      expect(await imported()).toHaveLength(2);
      expect((await uploads()).map(({ status }) => status)).toEqual([
        'applied',
      ]);
    });

    it('Cancel closes the preview, and Apply on it then says so', async () => {
      const [preview] = await shareHistory(...lines());

      const canceled = await click(preview, 'cancel');

      expect(leaveFileTexts(canceled)).toEqual(['Canceled. Nothing changed.']);
      expect(actionIdsOf(canceled!)).toEqual([]);

      const update = await click(preview, 'apply');

      expect(leaveFileTexts(update)).toEqual(['Canceled. Nothing changed.']);
      expect(await imported()).toEqual([]);
      expect((await uploads()).map(({ status }) => status)).toEqual([
        'canceled',
      ]);
    });

    it('Apply more than 7 days after the preview says it expired', async () => {
      const [preview] = await shareHistory(...lines());
      travelTo('2026-06-25');

      const update = await click(preview, 'apply');

      expect(leaveFileTexts(update)).toEqual([
        'This preview has expired. Send the file again.',
      ]);
      expect(await imported()).toEqual([]);
    });

    it("tells HR it was applied when the result can't be shown", async () => {
      const [preview] = await shareHistory(...lines());
      const since = t.slackApi.mark();
      t.slackApi.failNext('chat.update');

      await click(preview, 'apply');

      expect((await uploads()).map(({ status }) => status)).toEqual([
        'applied',
      ]);
      const told = t.slackApi.ephemeralMessages(workspace.token, hr.slack_id, {
        since,
      });
      expect(told.map(({ text }) => text)).toEqual([
        "Applied, but the message couldn't be updated. Open Time off to check.",
      ]);
      expect(leaveFileTexts(told[0])).toEqual([
        '✅ Added 2 leaves for 1 person.',
      ]);
      expect(actionIdsOf(told[0])).toEqual([
        NavigationActionId.TimeOff,
        'undo',
      ]);
    });
  });

  describe('who may click', () => {
    it('an admin shares and applies a file', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const [preview] = await share(
        historyCsv(
          `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
        ),
        'leave-history.csv',
        admin,
      );

      const result = await click(preview, 'apply', admin);

      expect(leaveFileTexts(result)).toEqual([
        '✅ Added 1 leave for 1 person.',
      ]);
    });

    it.each([UserRole.Member, UserRole.Manager, UserRole.Finance])(
      'refuses a %s who clicks Apply, Cancel or Undo',
      async (role) => {
        const applied = await apply(
          shareHistory(
            `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
          ),
        );
        const [preview] = await shareHistory(
          `Anna Novak,${anna.email},Sick leave,2026-05-11,2026-05-12,`,
        );
        const intruder = await workspace.addUser({ role });
        const before = await rowsById(workspace.rows('vacation_requests'));
        const statuses = (await uploads()).map(({ status }) => status).sort();

        for (const action of ['apply', 'cancel']) {
          await t.slack
            .actOnMessage(workspace, intruder, preview, action)
            .expect(200);
        }
        await t.slack
          .actOnMessage(workspace, intruder, applied, 'undo')
          .expect(200);
        await t.idle();

        expect((await uploads()).map(({ status }) => status).sort()).toEqual(
          statuses,
        );
        expect(await rowsById(workspace.rows('vacation_requests'))).toEqual(
          before,
        );
        expect(t.slackApi.messageUpdates(workspace.token, preview)).toEqual([]);
        expect(t.slackApi.messageUpdates(workspace.token, applied)).toEqual([
          expect.anything(),
        ]);
      },
    );
  });

  describe("Home's checklist", () => {
    const LEAVE_STEP = {
      text: '*Bring in leave balances* · _optional_\nBalances and past leave from your spreadsheet, so everyone starts with the right number.',
      button: UsersTabViewActionId.ImportLeave,
    };

    const checklistOf = async (user: Tables<'users'>) =>
      ((await openAppHomeTab(t, workspace, user)).blocks as SlackJson[])
        .filter(({ block_id }) => block_id?.startsWith(SETUP_BLOCK_ID))
        .map(({ text, elements, accessory }) => ({
          text: text?.text ?? elements?.[0].text,
          ...(accessory && { button: accessory.action_id }),
        }));

    it('shows the leave step until a file is applied', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });

      expect(await checklistOf(admin)).toContainEqual(LEAVE_STEP);

      const [preview] = await shareHistory(
        `Anna Novak,${anna.email},Sick leave,2026-05-04,2026-05-05,`,
      );

      expect(await checklistOf(admin)).toContainEqual(LEAVE_STEP);

      await click(preview, 'apply');

      const checklist = await checklistOf(admin);
      expect(checklist).not.toContainEqual(LEAVE_STEP);
      expect(checklist).toContainEqual({
        text: '✅ Done: vacation policy, company rules, leave balances',
      });
    });
  });
});
