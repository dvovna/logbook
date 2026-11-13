import {
  REMIND_UNSUBMITTED_JOB,
  TimeEntryRemindersService,
} from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';
import { View } from '@slack/types/dist/views';
import { sql } from 'kysely';
import * as errorReporter from '@common/errors/error-reporter';
import {
  IJobsOptions,
  JobsService,
  JOBS_OPTIONS,
} from '@common/jobs/jobs.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import {
  actionIdsOf,
  buttonText,
  listItems,
  modalError,
  sectionTexts,
  totalCount,
  listCount,
  noticeOf,
  dayLines,
} from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';
import { addDays } from './support/dates';
import { travelTo } from './support/clock';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Reports → Time logs, Admin's and HR's.
const TIME_LOGS_TAB = [NavigationActionId.Reports, NavigationActionId.TimeLogs];

// Home → Edit Entries.
const MY_ENTRIES_TAB = [HomeTabActionId.EditTimeEntries];

const today = () => new Date().toISOString().slice(0, 10);

describe('Time entries', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let member: Tables<'users'>;
  let design: Tables<'teams'>;
  let acme: Tables<'clients'>;
  // A billable project of Acme that the Design team works on.
  let website: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
    design = await workspace.addTeam({ name: 'Design' });
    member = await workspace.addUser({
      team_id: design.id,
      name: 'Mia Member',
    });
    acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
      billable: true,
    });
    await workspace.assignToProject(website, { teams: [design] });
  });

  // Home → Log Time.
  const openLogTimeModal = async (user: Tables<'users'>) =>
    openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user),
      HomeTabActionId.LogTime,
    );

  // The form a slash command opens: the one for `trigger_id` after it.
  const openWithLogCommand = async (user: Tables<'users'>) => {
    const since = t.slackApi.mark();

    await t.slack
      .command('/api/slack/log', workspace, user)
      .expect(acknowledged);
    await t.idle();

    return t.slackApi.openedModal(workspace.token, { since });
  };

  const optionValues = (modal: View, actionId: string) =>
    findAction(modal.blocks, actionId).element.options.map(
      (option: { value: string }) => option.value,
    );

  const descriptionsOf = (view: View) =>
    listItems(view).map(({ fields }) => fields.Description);

  const statusesOf = (view: View) =>
    listItems(view).map(({ fields }) => fields.Status);

  const entries = async () =>
    (await workspace.rows('time_entries')).filter(
      ({ deleted_at }) => !deleted_at,
    );

  it('opens the same Log Time form with /log as the button on Home', async () => {
    for (const user of [member, admin]) {
      // Each modal Slack opens has an ID and a version (hash) of its own.
      const {
        id: _commandViewId,
        hash: _commandHash,
        ...fromCommand
      } = (await openWithLogCommand(user)) as View & {
        id?: string;
        hash?: string;
      };
      const {
        id: _homeViewId,
        hash: _homeHash,
        ...fromHome
      } = (await openLogTimeModal(user)) as View & {
        id?: string;
        hash?: string;
      };

      expect(fromCommand).toEqual(fromHome);
    }
  });

  describe('logging time from the Home tab', () => {
    it("offers a member their team's and their own projects, without archived ones", async () => {
      const research = await workspace.addProject({ name: 'Research' });
      const legacy = await workspace.addProject({
        name: 'Legacy',
        archived_at: new Date().toISOString(),
      });
      const ops = await workspace.addTeam({ name: 'Ops' });
      const opsPortal = await workspace.addProject({ name: 'Ops Portal' });
      await workspace.assignToProject(research, { users: [member] });
      await workspace.assignToProject(legacy, { teams: [design] });
      await workspace.assignToProject(opsPortal, { teams: [ops] });

      const modal = await openLogTimeModal(member);

      expect(modal.callback_id).toBe(ViewCallbackId.UserTimeEntry);
      // Projects with a client first, then by name.
      expect(optionValues(modal, 'projectId')).toEqual([
        website.id,
        research.id,
      ]);
      expect(actionIdsOf(modal)).toEqual([
        'projectId',
        'workDate',
        'hours',
        'description',
      ]);
    });

    it('shows an admin who and in which status the time is logged for', async () => {
      await workspace.assignToProject(website, { users: [admin] });

      const modal = await openLogTimeModal(admin);

      expect(modal.callback_id).toBe(ViewCallbackId.AdminTimeEntry);
      const userSelect = findAction(
        modal.blocks,
        TimeEntriesTabViewActionId.SelectUser,
      ).element;
      expect(userSelect.initial_option.value).toBe(admin.id);
      expect(
        findAction(modal.blocks, 'status').element.initial_option.value,
      ).toBe(TimeEntryStatus.Draft);
    });

    it.each([UserRole.Admin, UserRole.HR])(
      'lets %s log time for anyone on any active project',
      async (role) => {
        const viewer = await workspace.addUser({ role });
        const internal = await workspace.addProject({ name: 'Internal' });
        await workspace.addProject({
          name: 'Legacy',
          archived_at: new Date().toISOString(),
        });

        const modal = await openLogTimeModal(viewer);

        expect(modal.callback_id).toBe(ViewCallbackId.AdminTimeEntry);
        expect(optionValues(modal, 'projectId')).toEqual([
          website.id,
          internal.id,
        ]);
      },
    );

    it('tells a member without projects to ask for one', async () => {
      const ops = await workspace.addTeam({ name: 'Ops' });
      const newcomer = await workspace.addUser({ team_id: ops.id });

      const modal = await openLogTimeModal(newcomer);

      expect(sectionTexts(modal)).toEqual([
        'You have no projects to log time on yet. Ask an admin to add you or your team to a project.',
      ]);
      expect(modal).not.toHaveProperty('submit');
    });

    it("logs an admin's time for today on their only project", async () => {
      await workspace.assignToProject(website, { users: [admin] });
      const modal = await openLogTimeModal(admin);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          hours: '1.5',
          description: 'Kickoff',
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Saved as a draft: 1h 30m on Website. Submit it from Home when your time is complete.',
      );
      expect(await entries()).toEqual([
        expect.objectContaining({
          user_id: admin.id,
          project_id: website.id,
          work_date: today(),
          minutes: 90,
          description: 'Kickoff',
          status: TimeEntryStatus.Draft,
          created_by: admin.id,
          updated_by: admin.id,
        }),
      ]);
      await publishedHome(t, workspace, admin, since);
    });

    it("logs a member's time as a draft", async () => {
      const modal = await openLogTimeModal(member);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, member, modal, {
          hours: '1.5',
          description: 'Kickoff',
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, member, since))).toBe(
        '✅ Saved as a draft: 1h 30m on Website. Submit it from Home when your time is complete.',
      );
      expect(await entries()).toEqual([
        expect.objectContaining({
          user_id: member.id,
          team_id: design.id,
          project_id: website.id,
          minutes: 90,
          status: TimeEntryStatus.Draft,
          created_by: member.id,
        }),
      ]);
    });

    it('takes the client and billability from the project', async () => {
      await workspace.assignToProject(website, { users: [admin] });
      const modal = await openLogTimeModal(admin);

      await t.slack
        .submitView(workspace, admin, modal, { hours: '1' })
        .expect(200);

      expect(await entries()).toEqual([
        expect.objectContaining({ client_id: acme.id, billable: true }),
      ]);
    });

    it('logs time for the user and in the status the admin picks', async () => {
      await workspace.assignToProject(website, { users: [admin] });
      // Design has no manager: its entries wait for HR.
      const hr = await workspace.addUser({ role: UserRole.HR });
      const modal = await openLogTimeModal(admin);
      const since = t.slackApi.mark();

      const suggestions = await t.slack
        .suggest(
          workspace,
          admin,
          modal,
          TimeEntriesTabViewActionId.SelectUser,
          'mia',
        )
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        {
          text: { type: 'plain_text', text: 'Mia Member' },
          value: member.id,
        },
      ]);

      await t.slack
        .submitView(workspace, admin, modal, {
          [TimeEntriesTabViewActionId.SelectUser]: member.id,
          status: TimeEntryStatus.Submitted,
          hours: '1',
        })
        .expect(200);

      expect(await entries()).toEqual([
        expect.objectContaining({
          user_id: member.id,
          team_id: design.id,
          status: TimeEntryStatus.Submitted,
          created_by: admin.id,
        }),
      ]);

      // Its approver hears of it as of any submitted time; the admin who
      // logged it doesn't.
      await t.idle();
      expect(
        t.slackApi
          .postedMessages(workspace.token, hr.slack_id, { since })
          .map(({ text }) => text),
      ).toEqual([
        expect.stringContaining(
          '*Mia Member* submitted *1 time entry* (1h) for your approval',
        ),
      ]);
      expect(
        t.slackApi.postedMessages(workspace.token, admin.slack_id, { since }),
      ).toEqual([]);
    });

    it('reminds of unsubmitted entries on Home and submits them from there', async () => {
      await workspace.addTimeEntry(member, website, { minutes: 90 });
      await workspace.addTimeEntry(member, website, {
        minutes: 30,
        status: TimeEntryStatus.Rejected,
        work_date: addDays(today(), -7),
      });
      await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Submitted,
      });

      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home)).toContain(
        'Not submitted yet: *2 entries* (2h)',
      );
      expect(buttonText(home, HomeTabActionId.SubmitTimeEntries)).toBe(
        '📤 Submit for Approval (2)',
      );

      const after = await actOnTab(
        t,
        workspace,
        member,
        home,
        HomeTabActionId.SubmitTimeEntries,
      );

      expect((await entries()).map(({ status }) => status)).toEqual([
        TimeEntryStatus.Submitted,
        TimeEntryStatus.Submitted,
        TimeEntryStatus.Submitted,
      ]);
      expect(actionIdsOf(after)).not.toContain(
        HomeTabActionId.SubmitTimeEntries,
      );
      expect(noticeOf(after)).toBe('✅ 2 time entries (2h) sent for approval.');
    });
  });

  describe('validation', () => {
    beforeEach(() => workspace.assignToProject(website, { users: [admin] }));

    it('takes a decimal comma as well as a point', async () => {
      const modal = await openLogTimeModal(admin);

      const response = await t.slack
        .submitView(workspace, admin, modal, { hours: '1,5' })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(await entries()).toEqual([
        expect.objectContaining({ minutes: 90 }),
      ]);
    });

    it('accepts only whole quarter hours', async () => {
      const modal = await openLogTimeModal(admin);

      const rejected = await t.slack
        .submitView(workspace, admin, modal, { hours: '0.3' })
        .expect(200);

      // Next to the field, so the modal and what was typed stay as they are.
      expect(rejected.body).toEqual({
        response_action: 'errors',
        errors: { hours_block: 'Use 15-minute steps: 0.25, 0.5, 0.75, 1…' },
      });
      expect(await entries()).toEqual([]);

      const since = t.slackApi.mark();
      const accepted = await t.slack
        .submitView(workspace, admin, modal, { hours: '0.25' })
        .expect(200);

      expect(accepted.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Saved as a draft: 15m on Website. Submit it from Home when your time is complete.',
      );
      expect(await entries()).toEqual([
        expect.objectContaining({ minutes: 15 }),
      ]);
    });

    it.each(['0', '24.25', 'two'])('rejects %s hours', async (hours) => {
      const modal = await openLogTimeModal(admin);

      const response = await t.slack
        .submitView(workspace, admin, modal, { hours })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { hours_block: 'Hours must be a number between 0 and 24' },
      });
      expect(await entries()).toEqual([]);
    });

    it('caps the time per project and day at 24 hours', async () => {
      await workspace.addTimeEntry(admin, website, { minutes: 23 * 60 });
      await workspace.addTimeEntry(admin, website, {
        minutes: 60,
        deleted_at: new Date().toISOString(),
        deleted_by: admin.id,
      });
      const modal = await openLogTimeModal(admin);

      const rejected = await t.slack
        .submitView(workspace, admin, modal, { hours: '1.25' })
        .expect(200);

      expect(rejected.body).toEqual({
        response_action: 'errors',
        errors: {
          hours_block:
            'Total logged time for this project and date cannot exceed 24 hours',
        },
      });

      // Slack keeps the same form open, with the error under Hours.
      const since = t.slackApi.mark();
      const accepted = await t.slack
        .submitView(workspace, admin, modal, { hours: '1' })
        .expect(200);

      expect(accepted.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Saved as a draft: 1h on Website. Submit it from Home when your time is complete.',
      );
      expect(await entries()).toHaveLength(2);
    });

    it('is enforced by the time_entries minutes check constraint', async () => {
      const insert = (minutes: number) =>
        t.db
          .insertInto('time_entries')
          .values({
            slack_team_id: workspace.id,
            user_id: admin.id,
            project_id: website.id,
            work_date: today(),
            minutes,
            created_by: admin.id,
            updated_by: admin.id,
          })
          .execute();

      for (const minutes of [-15, 0, 20, 24 * 60 + 15]) {
        await expect(insert(minutes)).rejects.toMatchObject({
          code: '23514',
          message: expect.stringContaining('time_entries_minutes_check'),
        });
      }

      for (const minutes of [15, 24 * 60]) {
        await expect(insert(minutes)).resolves.toBeDefined();
      }
    });
  });

  describe('the time entries list', () => {
    it("groups entries by day, with the day's total over all its entries", async () => {
      // 11 entries on Wednesday: the 11th is on the second page.
      await workspace.addTimeEntries(
        member,
        website,
        Array.from({ length: 11 }, () => ({
          work_date: '2026-06-17',
          minutes: 15,
        })),
      );
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-16',
        minutes: 60,
      });

      const firstPage = await openAppHomeTab(t, workspace, member, [
        NavigationActionId.MyTime,
      ]);
      expect(dayLines(firstPage)).toEqual(['*Wed, 17 Jun 2026* · 2h 45m']);

      const secondPage = await actOnTab(
        t,
        workspace,
        member,
        firstPage,
        TimeEntriesTabViewActionId.PaginationNext,
      );
      expect(dayLines(secondPage)).toEqual([
        '*Wed, 17 Jun 2026* · 2h 45m',
        '*Tue, 16 Jun 2026* · 1h',
      ]);
    });

    it("counts a canceled entry in its day's total, over the filtered project only", async () => {
      const mobile = await workspace.addProject({ name: 'Mobile' });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-17',
        minutes: 60,
      });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-17',
        minutes: 30,
        status: TimeEntryStatus.Cancelled,
      });
      await workspace.addTimeEntry(member, mobile, {
        work_date: '2026-06-17',
        minutes: 120,
      });

      const myTime = await openAppHomeTab(t, workspace, member, [
        NavigationActionId.MyTime,
      ]);
      expect(dayLines(myTime)).toEqual(['*Wed, 17 Jun 2026* · 3h 30m']);

      const filtered = await actOnTab(
        t,
        workspace,
        member,
        myTime,
        TimeEntriesTabViewActionId.FilterByProject,
        website.id,
      );
      expect(dayLines(filtered)).toEqual(['*Wed, 17 Jun 2026* · 1h 30m']);
    });

    it('shows a member only their own entries, without admin navigation', async () => {
      await workspace.addTimeEntry(member, website, {
        minutes: 90,
        description: 'Kickoff',
      });
      await workspace.addTimeEntry(member, website, {
        description: 'Deleted work',
        deleted_at: new Date().toISOString(),
        deleted_by: member.id,
      });
      await workspace.addTimeEntry(admin, website, { description: 'Not mine' });

      const home = await openAppHomeTab(t, workspace, member);
      expect(actionIdsOf(home)).not.toContain(NavigationActionId.TimeLogs);

      const myEntries = await actOnTab(
        t,
        workspace,
        member,
        home,
        HomeTabActionId.EditTimeEntries,
      );
      // Their own list: the project leads, without their name.
      expect(listItems(myEntries)).toEqual([
        expect.objectContaining({
          title: 'Website',
          fields: expect.objectContaining({
            Client: 'Acme',
            Time: '1h 30m',
            Status: '📝 Draft',
            Description: 'Kickoff',
          }),
        }),
      ]);
      expect(totalCount(myEntries)).toBe(1);
    });

    it('goes back to Home from Edit Entries', async () => {
      const myEntries = await openAppHomeTab(
        t,
        workspace,
        member,
        MY_ENTRIES_TAB,
      );

      const home = await actOnTab(
        t,
        workspace,
        member,
        myEntries,
        NavigationActionId.Home,
      );

      expect(home.callback_id).toBe(ViewCallbackId.HomeTabView);
    });

    it("filters everyone's entries by user, project and dates", async () => {
      const internal = await workspace.addProject({ name: 'Internal' });
      await workspace.addTimeEntry(member, website, { description: 'Kickoff' });
      await workspace.addTimeEntry(member, internal, {
        work_date: addDays(today(), -1),
        description: 'Planning',
      });
      await workspace.addTimeEntry(admin, website, {
        work_date: addDays(today(), -3),
        description: 'Audit',
      });
      const act = (view: View, actionId: string, value?: string) =>
        actOnTab(t, workspace, admin, view, actionId, value);

      const timeLogs = await openAppHomeTab(t, workspace, admin, TIME_LOGS_TAB);
      const users = await t.slack
        .suggest(
          workspace,
          admin,
          timeLogs,
          TimeEntriesTabViewActionId.FilterByUser,
          'mia',
        )
        .expect(acknowledged);
      expect(users.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Mia Member' }, value: member.id },
      ]);

      const mias = await act(
        timeLogs,
        TimeEntriesTabViewActionId.FilterByUser,
        member.id,
      );
      expect(descriptionsOf(mias)).toEqual(['Kickoff', 'Planning']);

      const miasOnWebsite = await act(
        mias,
        TimeEntriesTabViewActionId.FilterByProject,
        website.id,
      );
      expect(descriptionsOf(miasOnWebsite)).toEqual(['Kickoff']);

      const everything = await act(
        miasOnWebsite,
        TimeEntriesTabViewActionId.ResetFilters,
      );
      expect(descriptionsOf(everything)).toEqual([
        'Kickoff',
        'Planning',
        'Audit',
      ]);

      const sinceYesterday = await act(
        everything,
        TimeEntriesTabViewActionId.FilterByFromDate,
        addDays(today(), -1),
      );
      expect(descriptionsOf(sinceYesterday)).toEqual(['Kickoff', 'Planning']);
      expect(
        findAction(
          sinceYesterday.blocks,
          TimeEntriesTabViewActionId.FilterByFromDate,
        ).element.initial_date,
      ).toBe(addDays(today(), -1));

      const yesterday = await act(
        sinceYesterday,
        TimeEntriesTabViewActionId.FilterByToDate,
        addDays(today(), -1),
      );
      expect(descriptionsOf(yesterday)).toEqual(['Planning']);
    });

    it('lets a member filter by their own projects only', async () => {
      await workspace.addProject({ name: 'Website archive' });
      const myEntries = await openAppHomeTab(
        t,
        workspace,
        member,
        MY_ENTRIES_TAB,
      );

      expect(actionIdsOf(myEntries)).not.toContain(
        TimeEntriesTabViewActionId.FilterByUser,
      );

      const projects = await t.slack
        .suggest(
          workspace,
          member,
          myEntries,
          TimeEntriesTabViewActionId.FilterByProject,
          'web',
        )
        .expect(acknowledged);
      expect(projects.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Website' }, value: website.id },
      ]);
    });

    // Six days of work, today's first.
    // Eleven entries, one more than a page.
    const addWorkOfElevenDays = async () => {
      for (let day = 0; day < 11; day += 1) {
        await workspace.addTimeEntry(admin, website, {
          work_date: addDays(today(), -day),
          description: `Day ${day}`,
        });
      }
    };

    it('lists the newest work first, ten per page', async () => {
      await addWorkOfElevenDays();

      const firstPage = await openAppHomeTab(
        t,
        workspace,
        admin,
        TIME_LOGS_TAB,
      );

      expect(descriptionsOf(firstPage)).toEqual(
        Array.from({ length: 10 }, (_, day) => `Day ${day}`),
      );
      expect(listCount(firstPage)).toBe('1–10 of 11');
    });

    it('pages to older work', async () => {
      await addWorkOfElevenDays();
      const firstPage = await openAppHomeTab(
        t,
        workspace,
        admin,
        TIME_LOGS_TAB,
      );

      const secondPage = await actOnTab(
        t,
        workspace,
        admin,
        firstPage,
        TimeEntriesTabViewActionId.PaginationNext,
      );
      expect(descriptionsOf(secondPage)).toEqual(['Day 10']);
    });

    it.each([UserRole.Admin, UserRole.HR])(
      "shows %s everyone's entries under Time logs",
      async (role) => {
        const viewer = await workspace.addUser({ role });
        await workspace.addTimeEntry(member, website, {
          description: 'Kickoff',
        });
        await workspace.addTimeEntry(viewer, website, {
          description: 'Audit',
        });

        const timeLogs = await openAppHomeTab(
          t,
          workspace,
          viewer,
          TIME_LOGS_TAB,
        );

        expect(descriptionsOf(timeLogs).sort()).toEqual(['Audit', 'Kickoff']);
      },
    );

    // Time logs, everyone's entries, are Admin's and HR's.
    it('shows a manager only their own entries, in My time', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      await workspace.addTimeEntry(member, website, { description: 'Kickoff' });
      await workspace.addTimeEntry(manager, website, { description: 'Audit' });

      const myTime = await openAppHomeTab(t, workspace, manager, [
        NavigationActionId.MyTime,
      ]);

      expect(descriptionsOf(myTime)).toEqual(['Audit']);
    });

    it('shows an admin only their own entries under Edit Entries, on every page', async () => {
      // Eleven entries of the shown week, one more than a page.
      for (let entry = 0; entry < 11; entry += 1) {
        await workspace.addTimeEntry(admin, website, {
          description: `Entry ${entry}`,
        });
      }
      await workspace.addTimeEntry(member, website, { description: 'Kickoff' });

      const firstPage = await openAppHomeTab(
        t,
        workspace,
        admin,
        MY_ENTRIES_TAB,
      );
      expect(descriptionsOf(firstPage)).not.toContain('Kickoff');
      expect(totalCount(firstPage)).toBe(11);

      const secondPage = await actOnTab(
        t,
        workspace,
        admin,
        firstPage,
        TimeEntriesTabViewActionId.PaginationNext,
      );
      expect(descriptionsOf(secondPage)).toEqual(['Entry 0']);
    });
  });

  describe('summaries', () => {
    // Today is Wednesday 2026-06-17 (TEST_NOW): the week is June 15 to 21.
    it("shows a member today's and this week's time on Home", async () => {
      const internal = await workspace.addProject({ name: 'Internal' });
      await workspace.assignToProject(internal, { teams: [design] });
      await workspace.addTimeEntry(member, website, { minutes: 90 });
      await workspace.addTimeEntry(member, internal, { minutes: 30 });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-15',
      });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-14',
      });
      await workspace.addTimeEntry(member, website, {
        deleted_at: new Date().toISOString(),
        deleted_by: member.id,
      });
      await workspace.addTimeEntry(admin, website);

      const home = sectionTexts(await openAppHomeTab(t, workspace, member));

      expect(home).toContain('Today: *2h* (Acme 1h 30m, No client 30m)');
      expect(home).toContain('This week: *3h* total');
    });

    it('starts the week on Monday', async () => {
      travelTo('2026-06-15');
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-14',
      });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-15',
      });

      const home = sectionTexts(await openAppHomeTab(t, workspace, member));

      expect(home).toContain('Today: *1h* (Acme 1h)');
      expect(home).toContain('This week: *1h* total');
    });

    it('says when nothing is logged yet', async () => {
      const home = sectionTexts(await openAppHomeTab(t, workspace, member));

      expect(home).toContain('Nothing logged this week yet.');
      expect(home.some((text) => text.startsWith('This week'))).toBe(false);
    });

    it("sums up the workspace's week in Reports", async () => {
      const internal = await workspace.addProject({
        name: 'Internal',
        billable: false,
      });
      await workspace.addProject({
        name: 'Paused',
        status: 'on-hold',
      });
      await workspace.addProject({
        name: 'Old',
        archived_at: new Date().toISOString(),
      });
      await workspace.addTimeEntry(member, website, { minutes: 90 });
      await workspace.addTimeEntry(admin, website, { minutes: 30 });
      await workspace.addTimeEntry(member, internal, {
        minutes: 60,
        billable: false,
      });
      await workspace.addTimeEntry(member, website, {
        work_date: addDays(today(), -7),
      });

      const reports = sectionTexts(
        await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
      );

      expect(reports).toContain(
        '*This week*\n*3h* logged · *2h* billable · *2* active projects',
      );
    });

    // The database answers a query with 1000 rows at most and says nothing
    // about the rest.
    it('sums a week of more entries than one answer of the database holds', async () => {
      const week = ['15', '16', '17', '18', '19', '20', '21'];
      await workspace.addTimeEntries(
        member,
        website,
        Array.from({ length: 1001 }, (_, index) => ({
          work_date: `2026-06-${week[index % week.length]}`,
          minutes: 15,
        })),
      );

      const reports = sectionTexts(
        await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
      );

      expect(reports).toContain(
        '*This week*\n*250h 15m* logged · *250h 15m* billable · *1* active projects',
      );
    });
  });

  describe('submitting for approval', () => {
    const statusOf = async (entry: Tables<'time_entries'>) =>
      (await workspace.row('time_entries', entry.id)).status;

    it('submits all drafts and rejected entries at once', async () => {
      const draft = await workspace.addTimeEntry(member, website);
      const rejected = await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Rejected,
      });
      const approved = await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Approved,
      });
      const myEntries = await openAppHomeTab(
        t,
        workspace,
        member,
        MY_ENTRIES_TAB,
      );
      expect(buttonText(myEntries, TimeEntriesTabViewActionId.SubmitWeek)).toBe(
        '📤 Submit week (2)',
      );

      const updated = await actOnTab(
        t,
        workspace,
        member,
        myEntries,
        TimeEntriesTabViewActionId.SubmitWeek,
      );

      expect(await statusOf(draft)).toBe(TimeEntryStatus.Submitted);
      expect(await statusOf(rejected)).toBe(TimeEntryStatus.Submitted);
      expect(await statusOf(approved)).toBe(TimeEntryStatus.Approved);
      expect(actionIdsOf(updated)).not.toContain(
        TimeEntriesTabViewActionId.SubmitWeek,
      );
      expect(statusesOf(updated).sort()).toEqual([
        '✅ Approved',
        '📤 Submitted',
        '📤 Submitted',
      ]);
      expect(noticeOf(updated)).toBe(
        '✅ 2 time entries (2h) sent for approval.',
      );
    });

    it('submits one entry from its menu', async () => {
      const first = await workspace.addTimeEntry(member, website);
      const second = await workspace.addTimeEntry(member, website);
      const myEntries = await openAppHomeTab(
        t,
        workspace,
        member,
        MY_ENTRIES_TAB,
      );

      const updated = await actOnTab(
        t,
        workspace,
        member,
        myEntries,
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.SubmitTimeEntry}:${first.id}`,
      );

      expect(await statusOf(first)).toBe(TimeEntryStatus.Submitted);
      expect(await statusOf(second)).toBe(TimeEntryStatus.Draft);
      expect(buttonText(updated, TimeEntriesTabViewActionId.SubmitWeek)).toBe(
        '📤 Submit week (1)',
      );
      expect(noticeOf(updated)).toBe('✅ 1 time entry (1h) sent for approval.');
    });

    it('takes away the menu of a submitted entry from its owner', async () => {
      await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Submitted,
      });

      const myEntries = await openAppHomeTab(
        t,
        workspace,
        member,
        MY_ENTRIES_TAB,
      );

      expect(listItems(myEntries)).toEqual([
        expect.objectContaining({
          fields: expect.objectContaining({ Status: '📤 Submitted' }),
          menu: [],
        }),
      ]);
    });

    it('refuses an edit that arrives after the entry was submitted', async () => {
      const entry = await workspace.addTimeEntry(member, website);
      const modal = await openModalFrom(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member, MY_ENTRIES_TAB),
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
      );
      await t.db
        .updateTable('time_entries')
        .set({ status: TimeEntryStatus.Submitted })
        .where('id', '=', entry.id)
        .execute();

      const response = await t.slack
        .submitView(workspace, member, modal, { hours: '2' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'Submitted time entries cannot be edited',
      );
      expect((await workspace.row('time_entries', entry.id)).minutes).toBe(60);
    });

    it('makes a fixed rejected entry a draft again', async () => {
      const entry = await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Rejected,
      });
      const modal = await openModalFrom(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member, MY_ENTRIES_TAB),
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
      );

      await t.slack
        .submitView(workspace, member, modal, { hours: '2' })
        .expect(200);

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        minutes: 120,
        status: TimeEntryStatus.Draft,
      });
    });

    it('lets HR still correct a submitted entry', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      const entry = await workspace.addTimeEntry(member, website, {
        status: TimeEntryStatus.Submitted,
      });
      const modal = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, TIME_LOGS_TAB),
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
      );

      await t.slack
        .submitView(workspace, hr, modal, { hours: '0.5' })
        .expect(200);

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        user_id: member.id,
        minutes: 30,
        status: TimeEntryStatus.Submitted,
        updated_by: hr.id,
      });
    });
  });

  describe('changing an entry', () => {
    // The modal behind the entry's menu item `item` in the time entries tab
    // that `path` leads `user` to.
    const openFromMenu = async (
      item: TimeEntriesTabViewActionId,
      entry: Tables<'time_entries'>,
      user = admin,
      path: string[] = TIME_LOGS_TAB,
    ) =>
      openModalFrom(
        t,
        workspace,
        user,
        await openAppHomeTab(t, workspace, user, path),
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${item}:${entry.id}`,
      );

    it('edits an entry', async () => {
      await workspace.assignToProject(website, { users: [admin] });
      const entry = await workspace.addTimeEntry(admin, website, {
        minutes: 90,
      });

      const modal = await openFromMenu(
        TimeEntriesTabViewActionId.EditTimeEntry,
        entry,
      );
      expect(findAction(modal.blocks, 'hours').element.initial_value).toBe(
        '1.5',
      );

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, { hours: '2' })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Saved as a draft: 2h on Website. Submit it from Home when your time is complete.',
      );
      expect(await entries()).toEqual([
        expect.objectContaining({ id: entry.id, minutes: 120 }),
      ]);
      expect(
        listItems(await publishedHome(t, workspace, admin, since))[0].fields
          .Time,
      ).toBe('2h');
    });

    it('keeps the team an entry was logged in when its person moved since', async () => {
      const ops = await workspace.addTeam({ name: 'Ops' });
      const entry = await workspace.addTimeEntry(member, website, {
        team_id: design.id,
      });
      await t.db
        .updateTable('users')
        .set({ team_id: ops.id })
        .where('id', '=', member.id)
        .execute();

      await t.slack
        .submitView(
          workspace,
          admin,
          await openFromMenu(TimeEntriesTabViewActionId.EditTimeEntry, entry),
          { description: 'Typo fixed' },
        )
        .expect(200);

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        description: 'Typo fixed',
        team_id: design.id,
      });
    });

    it('lets a member edit their own entry from Edit Entries', async () => {
      const entry = await workspace.addTimeEntry(member, website, {
        minutes: 90,
      });

      const modal = await openFromMenu(
        TimeEntriesTabViewActionId.EditTimeEntry,
        entry,
        member,
        MY_ENTRIES_TAB,
      );
      await t.slack
        .submitView(workspace, member, modal, { description: 'Kickoff call' })
        .expect(200);

      expect(await entries()).toEqual([
        expect.objectContaining({
          id: entry.id,
          minutes: 90,
          description: 'Kickoff call',
          updated_by: member.id,
        }),
      ]);
    });

    it('keeps the daily cap when an entry gets longer', async () => {
      await workspace.assignToProject(website, { users: [admin] });
      await workspace.addTimeEntry(admin, website, { minutes: 23 * 60 });
      const entry = await workspace.addTimeEntry(admin, website);

      const modal = await openFromMenu(
        TimeEntriesTabViewActionId.EditTimeEntry,
        entry,
      );
      const response = await t.slack
        .submitView(workspace, admin, modal, { hours: '1.25' })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: {
          hours_block:
            'Total logged time for this project and date cannot exceed 24 hours',
        },
      });
      expect((await workspace.row('time_entries', entry.id)).minutes).toBe(60);
    });

    it('deletes an entry', async () => {
      const entry = await workspace.addTimeEntry(admin, website, {
        description: 'Typo',
      });

      const confirmation = await openFromMenu(
        TimeEntriesTabViewActionId.DeleteTimeEntry,
        entry,
      );
      // It says which entry goes.
      expect(sectionTexts(confirmation)[0]).toMatch(
        /^\*[0-9hm ]+\* on \*Website\* 17 Jun 2026 will be deleted\.\n_Typo_$/,
      );
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Time entry deleted.',
      );
      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        deleted_at: expect.any(String),
        deleted_by: admin.id,
      });
      expect(
        listItems(await publishedHome(t, workspace, admin, since)),
      ).toEqual([]);
    });
  });

  // Today is Wednesday 2026-06-17: the week started on Monday 2026-06-15.
  describe('the weekly reminder', () => {
    afterEach(() => jest.restoreAllMocks());

    it('reminds of drafts and rejected entries from before the week, once', async () => {
      const reminders = t.app.get(TimeEntryRemindersService);
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-10',
        minutes: 120,
      });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-11',
        minutes: 60,
        status: TimeEntryStatus.Rejected,
      });
      // This week's draft, and time already sent, are no reason to remind.
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-16',
      });
      await workspace.addTimeEntry(admin, website, {
        work_date: '2026-06-10',
        status: TimeEntryStatus.Submitted,
      });
      const since = t.slackApi.mark();

      expect(await reminders.remindWorkspace(workspace.id, '2026-06-15')).toBe(
        1,
      );
      await t.idle();
      expect(
        t.slackApi
          .postedMessages(workspace.token, member.slack_id, { since })
          .map(({ text }) => text),
      ).toEqual([
        [
          ':alarm_clock: You have *2 time entries* (3h) from 10–11 Jun 2026 not submitted yet.',
          '1 of them was rejected: fix it under Home → ✏️ Edit Entries (week of 8 Jun).',
          'Your approvers see time only once you submit it: Home → 📤 Submit for Approval.',
          'Change how often you are reminded: Home → 🔔 Reminders.',
        ].join('\n'),
      ]);
      expect(
        t.slackApi.postedMessages(workspace.token, admin.slack_id, { since }),
      ).toEqual([]);

      // A restart, or the next tick, sends nothing more this week.
      expect(await reminders.remindWorkspace(workspace.id, '2026-06-15')).toBe(
        0,
      );
    });

    it('saves the reminders of many people in one statement, and sends them a few a second', async () => {
      const reminders = t.app.get(TimeEntryRemindersService);
      const people = [member];
      for (let index = 1; index < 6; index += 1) {
        people.push(
          await workspace.addUser({
            team_id: design.id,
            name: `Person ${index}`,
          }),
        );
      }
      for (const person of people) {
        await workspace.addTimeEntry(person, website, {
          work_date: '2026-06-10',
        });
      }
      const since = t.sql.mark();
      const messagesSince = t.slackApi.mark();
      const start = performance.now();

      expect(await reminders.remindWorkspace(workspace.id, '2026-06-15')).toBe(
        6,
      );
      await t.idle();
      const elapsed = performance.now() - start;

      expect(
        t.sql
          .statements(since)
          .filter(({ text }) => /insert into \S+\.job \(/i.test(text)),
      ).toHaveLength(1);
      // begin, the week's claim, who has open time, the jobs, commit: the
      // same however many people there are.
      expect(t.sql.count(since).answer.statements).toBe(5);
      for (const person of people) {
        expect(
          t.slackApi.postedMessages(workspace.token, person.slack_id, {
            since: messagesSince,
          }),
        ).toHaveLength(1);
      }
      // Five a second: the sixth starts a second after the first.
      expect(elapsed).toBeGreaterThanOrEqual(950);
    });

    it('keeps a reminder Slack refused for a retry, as any job', async () => {
      const reminders = t.app.get(TimeEntryRemindersService);
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-10',
      });
      t.slackApi.failNextTo(member.slack_id);
      const since = t.slackApi.mark();

      expect(await reminders.remindWorkspace(workspace.id, '2026-06-15')).toBe(
        1,
      );
      await t.idle();
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id, { since }),
      ).toEqual([]);

      // Saved with its queue's retries, due 5 minutes on, as send() saves one.
      const { schema } = t.app.get<IJobsOptions>(JOBS_OPTIONS);
      const { rows } = await sql<{ queue_retries: boolean; wait: number }>`
        select j.retry_limit = q.retry_limit
            and j.retry_delay = q.retry_delay
            and j.retry_backoff = q.retry_backoff as queue_retries,
          extract(epoch from j.start_after - j.created_on)::int as wait
        from ${sql.table(`${schema}.job`)} j
        join ${sql.table(`${schema}.queue`)} q on q.name = j.name
        where j.name = ${REMIND_UNSUBMITTED_JOB}
          and j.data ->> 'userId' = ${member.id}
      `.execute(t.db);
      expect(rows).toEqual([{ queue_retries: true, wait: 300 }]);

      await t.retryJobs();

      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id, { since }),
      ).toHaveLength(1);
    });

    it('goes on with the other workspaces when one fails, and tries that one again at the next tick', async () => {
      const reminders = t.app.get(TimeEntryRemindersService);
      const timeEntries = t.app.get(TimeEntriesService);
      const other = await t.createWorkspace();
      const otherMember = await other.addUser({ name: 'Olga Other' });
      const intranet = await other.addProject({ name: 'Intranet' });
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-10',
      });
      await other.addTimeEntry(otherMember, intranet, {
        work_date: '2026-06-10',
      });
      // The workspaces of the tests running beside this one stay out of it.
      jest
        .spyOn(t.app.get(SlackTeamsService), 'findInstalledIds')
        .mockResolvedValue([workspace.id, other.id]);
      const timeout = new Error('canceling statement due to statement timeout');
      const findUserIds = timeEntries.findUserIdsWithOpenUpTo.bind(timeEntries);
      jest
        .spyOn(timeEntries, 'findUserIdsWithOpenUpTo')
        .mockImplementation((params) =>
          params.slackTeamId === workspace.id
            ? Promise.reject(timeout)
            : findUserIds(params),
        );
      const report = jest
        .spyOn(errorReporter, 'reportError')
        .mockImplementation();
      const since = t.slackApi.mark();
      const reminderWeekOf = async (slackTeamId: string) =>
        (
          await t.db
            .selectFrom('slack_teams')
            .select('time_reminder_week')
            .where('id', '=', slackTeamId)
            .executeTakeFirstOrThrow()
        ).time_reminder_week;

      expect(await reminders.remindAll(new Date('2026-06-15T09:05:00Z'))).toBe(
        1,
      );
      await t.idle();

      expect(
        t.slackApi.postedMessages(other.token, otherMember.slack_id, { since }),
      ).toHaveLength(1);
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id, { since }),
      ).toEqual([]);
      expect(report).toHaveBeenCalledWith(timeout, {
        task: 'remind of unsubmitted time',
        slackTeamId: workspace.id,
      });
      expect(await reminderWeekOf(workspace.id)).toBeNull();
      expect(await reminderWeekOf(other.id)).toBe('2026-06-15');

      jest.restoreAllMocks();
      expect(await reminders.remindWorkspace(workspace.id, '2026-06-15')).toBe(
        1,
      );
      await t.idle();
      expect(
        t.slackApi.postedMessages(workspace.token, member.slack_id, { since }),
      ).toHaveLength(1);
    });

    describe('by how often each person wants it', () => {
      const remindedEvery = (user: Tables<'users'>, timeReminder: string) =>
        t.db
          .updateTable('users')
          .set({ time_reminder: timeReminder })
          .where('id', '=', user.id)
          .execute();

      const textsTo = (user: Tables<'users'>, since: number) =>
        t.slackApi
          .postedMessages(workspace.token, user.slack_id, { since })
          .map(({ text }) => text);

      it('reminds the daily ones every working day of what is open from before it, once', async () => {
        const reminders = t.app.get(TimeEntryRemindersService);
        await remindedEvery(member, 'daily');
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-06-16',
          minutes: 120,
        });
        // Today's draft is no reason yet, and the admin is reminded weekly.
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-06-17',
        });
        await workspace.addTimeEntry(admin, website, {
          work_date: '2026-06-16',
        });
        const since = t.slackApi.mark();

        expect(await reminders.remindDaily(workspace.id, '2026-06-17')).toBe(1);
        await t.idle();
        expect(textsTo(member, since)).toEqual([
          [
            ':alarm_clock: You have *1 time entry* (2h) from 16 Jun 2026 not submitted yet.',
            'Your approvers see time only once you submit it: Home → 📤 Submit for Approval.',
            'Change how often you are reminded: Home → 🔔 Reminders.',
          ].join('\n'),
        ]);
        expect(textsTo(admin, since)).toEqual([]);

        expect(await reminders.remindDaily(workspace.id, '2026-06-17')).toBe(0);
        expect(await reminders.remindDaily(workspace.id, '2026-06-18')).toBe(1);
      });

      it('leaves the daily, monthly and switched-off ones out of an ordinary week', async () => {
        const reminders = t.app.get(TimeEntryRemindersService);
        const daily = await workspace.addUser({ name: 'Dana Daily' });
        const monthly = await workspace.addUser({ name: 'Mona Monthly' });
        const never = await workspace.addUser({ name: 'Nora Never' });
        await remindedEvery(daily, 'daily');
        await remindedEvery(monthly, 'monthly');
        await remindedEvery(never, 'off');

        for (const user of [member, daily, monthly, never]) {
          await workspace.addTimeEntry(user, website, {
            work_date: '2026-06-10',
          });
        }
        const since = t.slackApi.mark();

        expect(
          await reminders.remindWorkspace(workspace.id, '2026-06-15'),
        ).toBe(1);
        await t.idle();
        expect(textsTo(member, since)).toHaveLength(1);
        expect(textsTo(daily, since)).toEqual([]);
        expect(textsTo(monthly, since)).toEqual([]);
        expect(textsTo(never, since)).toEqual([]);
      });

      it('reminds the monthly ones in the week of the first Monday only', async () => {
        const reminders = t.app.get(TimeEntryRemindersService);
        await remindedEvery(member, 'monthly');
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-05-28',
        });

        expect(
          await reminders.remindWorkspace(workspace.id, '2026-06-01'),
        ).toBe(1);
        expect(
          await reminders.remindWorkspace(workspace.id, '2026-06-08'),
        ).toBe(0);
      });

      // On a Monday the week's and the day's reminders both go out.
      it('reminds a daily person once on a Monday', async () => {
        const reminders = t.app.get(TimeEntryRemindersService);
        await remindedEvery(member, 'daily');
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-06-10',
        });
        const since = t.slackApi.mark();

        await reminders.remindWorkspace(workspace.id, '2026-06-15');
        await reminders.remindDaily(workspace.id, '2026-06-15');
        await t.idle();

        expect(textsTo(member, since)).toHaveLength(1);
      });

      it('sends nothing to someone who turned the reminder off after it was saved', async () => {
        const reminders = t.app.get(TimeEntryRemindersService);
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-06-10',
        });
        t.slackApi.failNextTo(member.slack_id);
        const since = t.slackApi.mark();

        expect(
          await reminders.remindWorkspace(workspace.id, '2026-06-15'),
        ).toBe(1);
        await t.idle();
        await remindedEvery(member, 'off');
        await t.retryJobs();

        expect(textsTo(member, since)).toEqual([]);
      });

      // A job the release before saved names only its Monday.
      it('still sends a reminder saved without its last day', async () => {
        await workspace.addTimeEntry(member, website, {
          work_date: '2026-06-10',
        });
        const since = t.slackApi.mark();

        await t.app.get(JobsService).enqueue(REMIND_UNSUBMITTED_JOB, {
          slackTeamId: workspace.id,
          userId: member.id,
          monday: '2026-06-15',
        });
        await t.idle();

        expect(textsTo(member, since)).toHaveLength(1);
      });
    });

    it('waits for Monday 09:00 UTC', async () => {
      const reminders = t.app.get(TimeEntryRemindersService);
      await workspace.addTimeEntry(member, website, {
        work_date: '2026-06-10',
      });

      expect(await reminders.remindAll(new Date('2026-06-15T08:59:00Z'))).toBe(
        0,
      );
      expect(
        (
          await t.db
            .selectFrom('slack_teams')
            .select('time_reminder_week')
            .where('id', '=', workspace.id)
            .executeTakeFirstOrThrow()
        ).time_reminder_week,
      ).toBeNull();
    });
  });
});
