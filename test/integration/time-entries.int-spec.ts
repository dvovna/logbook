import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction, textOf } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import { addDays } from './support/dates';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Home → Time & Billing → Time logs.
const TIME_LOGS_TAB = [
  AdminNavigationActionId.ManageTimeAndBilling,
  AdminNavigationActionId.ManageTimeLogs,
];

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

  const optionValues = (modal: View, actionId: string) =>
    findAction(modal.blocks, actionId).element.options.map(
      (option: { value: string }) => option.value,
    );

  const entries = async () =>
    (await workspace.rows('time_entries')).filter(
      ({ deleted_at }) => !deleted_at,
    );

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
      expect(textOf(modal)).not.toContain('Select user');
      expect(textOf(modal)).not.toContain('"status"');
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

      expect(textOf(response.body.view)).toContain(
        'Time Log was created successfully!',
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

      const response = await t.slack
        .submitView(workspace, member, modal, {
          hours: '1.5',
          description: 'Kickoff',
        })
        .expect(200);

      expect(response.body).toMatchObject({ response_action: 'update' });
      expect(textOf(response.body.view)).toContain(
        'Time Log was created successfully!',
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
      const modal = await openLogTimeModal(admin);

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
    });
  });

  describe('validation', () => {
    beforeEach(() => workspace.assignToProject(website, { users: [admin] }));

    it('accepts only whole quarter hours', async () => {
      const modal = await openLogTimeModal(admin);

      const rejected = await t.slack
        .submitView(workspace, admin, modal, { hours: '0.3' })
        .expect(200);

      expect(textOf(rejected.body.view)).toContain(
        'Logged minutes must be in 15 - minute increments',
      );
      expect(await entries()).toEqual([]);

      // The user corrects the hours in the modal the app answered with.
      const accepted = await t.slack
        .submitView(workspace, admin, rejected.body.view, { hours: '0.25' })
        .expect(200);

      expect(textOf(accepted.body.view)).toContain(
        'Time Log was created successfully!',
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

      expect(textOf(rejected.body.view)).toContain(
        'Total logged time for this project and date cannot exceed 24 hours',
      );

      const accepted = await t.slack
        .submitView(workspace, admin, rejected.body.view, { hours: '1' })
        .expect(200);

      expect(textOf(accepted.body.view)).toContain(
        'Time Log was created successfully!',
      );
      expect(await entries()).toHaveLength(2);
    });

    it('is enforced by the time_entries minutes check constraint', async () => {
      const insert = (minutes: number) =>
        t.db.from('time_entries').insert({
          slack_team_id: workspace.id,
          user_id: admin.id,
          project_id: website.id,
          work_date: today(),
          minutes,
          created_by: admin.id,
          updated_by: admin.id,
        });

      for (const minutes of [-15, 0, 20, 24 * 60 + 15]) {
        expect((await insert(minutes)).error).toMatchObject({
          code: '23514',
          message: expect.stringContaining('time_entries_minutes_check'),
        });
      }

      for (const minutes of [15, 24 * 60]) {
        expect((await insert(minutes)).error).toBeNull();
      }
    });
  });

  describe('the time entries list', () => {
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
      expect(textOf(home)).not.toContain(
        AdminNavigationActionId.ManageTimeAndBilling,
      );

      const myEntries = textOf(
        await actOnTab(
          t,
          workspace,
          member,
          home,
          HomeTabActionId.EditTimeEntries,
        ),
      );
      expect(myEntries).toContain('*Mia Member*');
      expect(myEntries).toContain('Project: Website');
      expect(myEntries).toContain('Client: Acme');
      expect(myEntries).toContain('Time: 1h 30m');
      expect(myEntries).toContain('Description: Kickoff');
      expect(myEntries).not.toContain('Deleted work');
      expect(myEntries).not.toContain('Not mine');
      expect(myEntries).toContain('Total Count: 1');
    });

    // Six days of work, today's first.
    const addWeekOfWork = async () => {
      for (let day = 0; day < 6; day += 1) {
        await workspace.addTimeEntry(admin, website, {
          work_date: addDays(today(), -day),
          description: `Day ${day}`,
        });
      }
    };

    it('lists the newest work first, five per page', async () => {
      await addWeekOfWork();

      const firstPage = await openAppHomeTab(
        t,
        workspace,
        admin,
        TIME_LOGS_TAB,
      );

      expect(textOf(firstPage).match(/Day \d/g)).toEqual([
        'Day 0',
        'Day 1',
        'Day 2',
        'Day 3',
        'Day 4',
      ]);
      expect(textOf(firstPage)).toContain('Total Count: 6');
      expect(textOf(firstPage)).toContain('Page 1 of 2');
    });

    it('pages to older work', async () => {
      await addWeekOfWork();
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
      expect(textOf(secondPage).match(/Day \d/g)).toEqual(['Day 5']);
    });

    // BUG?: the tab always filters by the viewer (time-entries-tab.service.ts:66),
    // so under Time & Billing → Time logs an admin sees only their own entries,
    // although the tab offers a User filter.
    it.failing(
      "shows an admin everyone's entries under Time logs",
      async () => {
        await workspace.addTimeEntry(member, website, {
          description: 'Kickoff',
        });
        await workspace.addTimeEntry(admin, website, { description: 'Review' });

        const timeLogs = textOf(
          await openAppHomeTab(t, workspace, admin, TIME_LOGS_TAB),
        );

        expect(timeLogs).toContain('Review');
        expect(timeLogs).toContain('Kickoff');
      },
    );
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

      expect(textOf(response.body.view)).toContain(
        'Time Log was updated successfully!',
      );
      expect(await entries()).toEqual([
        expect.objectContaining({ id: entry.id, minutes: 120 }),
      ]);
      expect(textOf(await publishedHome(t, workspace, admin, since))).toContain(
        'Time: 2h',
      );
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

      expect(textOf(response.body.view)).toContain(
        'Total logged time for this project and date cannot exceed 24 hours',
      );
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
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        'The time entry has been deleted.',
      );
      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        deleted_at: expect.any(String),
        deleted_by: admin.id,
      });
      expect(
        textOf(await publishedHome(t, workspace, admin, since)),
      ).not.toContain('Typo');
    });
  });
});
