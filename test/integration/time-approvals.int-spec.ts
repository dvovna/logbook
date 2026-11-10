import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  buttonText,
  listItems,
  modalError,
  sectionTexts,
  noticeOf,
} from './support/tab-readers';
import { addDays } from './support/dates';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// The Approvals inbox.
const APPROVALS_TAB = [NavigationActionId.Approvals];

const today = () => new Date().toISOString().slice(0, 10);

describe('Time approvals', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  // Approves the Design team's entries.
  let manager: Tables<'users'>;
  let member: Tables<'users'>;
  // In a team without a manager.
  let opsMember: Tables<'users'>;
  let website: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({ role: UserRole.Manager });
    const design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [manager.slack_id],
    });
    const ops = await workspace.addTeam({ name: 'Ops' });
    await t.db
      .updateTable('users')
      .set({ team_id: design.id })
      .where('id', '=', manager.id)
      .execute();
    manager = { ...manager, team_id: design.id };
    member = await workspace.addUser({
      team_id: design.id,
      name: 'Mia Member',
    });
    opsMember = await workspace.addUser({ team_id: ops.id });
    const acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
  });

  const submitted = (
    user: Tables<'users'>,
    fields: Partial<Tables<'time_entries'>> = {},
  ) =>
    workspace.addTimeEntry(user, website, {
      status: TimeEntryStatus.Submitted,
      ...fields,
    });

  const statusOf = async (entry: Tables<'time_entries'>) =>
    (await workspace.row('time_entries', entry.id)).status;

  describe('what waits for whom', () => {
    it('shows a manager the submitted entries of their team, not their own', async () => {
      await submitted(member, { description: 'Kickoff' });
      await workspace.addTimeEntry(member, website, { description: 'Draft' });
      await submitted(opsMember, { description: 'Ops work' });
      await submitted(manager, { description: 'Own work' });

      const home = await openAppHomeTab(t, workspace, manager);
      expect(buttonText(home, NavigationActionId.Approvals)).toBe(
        '✅ Approvals (1)',
      );

      const approvals = await actOnTab(
        t,
        workspace,
        manager,
        home,
        NavigationActionId.Approvals,
      );
      expect(listItems(approvals)).toEqual([
        expect.objectContaining({
          title: 'Mia Member',
          fields: expect.objectContaining({ Description: 'Kickoff' }),
          buttons: [
            ApprovalsTabActionId.ApproveEntry,
            ApprovalsTabActionId.RejectEntry,
          ],
        }),
      ]);
      expect(buttonText(approvals, ApprovalsTabActionId.ApproveAll)).toBe(
        'Approve all (1)',
      );
    });

    it("shows HR everyone's submitted entries but their own", async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      await submitted(member, { description: 'Kickoff' });
      await submitted(opsMember, { description: 'Ops work' });
      await submitted(hr, { description: 'Own work' });

      const approvals = await openAppHomeTab(t, workspace, hr, APPROVALS_TAB);

      expect(
        listItems(approvals)
          .map(({ fields }) => fields.Description)
          .sort(),
      ).toEqual(['Kickoff', 'Ops work']);
    });
  });

  describe('deciding', () => {
    it('approves an entry', async () => {
      const entry = await submitted(member);
      const approvals = await openAppHomeTab(
        t,
        workspace,
        manager,
        APPROVALS_TAB,
      );

      const updated = await actOnTab(
        t,
        workspace,
        manager,
        approvals,
        ApprovalsTabActionId.ApproveEntry,
        entry.id,
      );

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        status: TimeEntryStatus.Approved,
        updated_by: manager.id,
      });
      expect(sectionTexts(updated)).toContain(
        '_No time entries wait for you._',
      );
    });

    it('rejects an entry and tells its owner why', async () => {
      const entry = await submitted(member, { work_date: '2026-11-02' });
      const reject = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, APPROVALS_TAB),
        ApprovalsTabActionId.RejectEntry,
        entry.id,
      );

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, manager, reject, { reason: 'Wrong project' })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, manager, since))).toBe(
        '❌ Rejected. Mia Member gets a message about it.',
      );
      expect(await statusOf(entry)).toBe(TimeEntryStatus.Rejected);
      await t.idle();
      const [posted] = t.slackApi.postedMessages(
        workspace.token,
        member.slack_id,
      );
      expect(posted?.text).toBe(
        [
          `:x: ${manager.name} rejected your time entry: *Website* (Acme), 2 Nov 2026, 1h.`,
          '>Wrong project',
          'Fix it under Home → ✏️ Edit Entries and submit it again.',
        ].join('\n'),
      );
      expect(
        sectionTexts(await publishedHome(t, workspace, manager, since)),
      ).toContain('_No time entries wait for you._');

      // The owner sees why in their list, until they send it again.
      const myEntries = await openAppHomeTab(t, workspace, member, [
        HomeTabActionId.EditTimeEntries,
      ]);
      expect(listItems(myEntries)[0].fields).toMatchObject({
        Status: 'Rejected',
        Reason: 'Wrong project',
      });

      await actOnTab(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member),
        HomeTabActionId.SubmitTimeEntries,
      );
      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        status: TimeEntryStatus.Submitted,
        rejection_reason: null,
      });
    });

    it('approves everything waiting at once, beyond the first page', async () => {
      const entries: Tables<'time_entries'>[] = [];
      for (let day = 0; day < 6; day += 1) {
        entries.push(
          await submitted(member, { work_date: addDays(today(), -day) }),
        );
      }
      const opsEntry = await submitted(opsMember);

      const confirmation = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, APPROVALS_TAB),
        ApprovalsTabActionId.ApproveAll,
      );
      expect(sectionTexts(confirmation)).toEqual([
        '6 time entries waiting for you will be approved.',
      ]);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, manager, confirmation)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, manager, since))).toBe(
        '✅ 6 time entries approved.',
      );
      for (const entry of entries) {
        expect(await statusOf(entry)).toBe(TimeEntryStatus.Approved);
      }
      expect(await statusOf(opsEntry)).toBe(TimeEntryStatus.Submitted);
    });

    it('reports an entry decided on by someone else in the meantime', async () => {
      const entry = await submitted(member);
      const reject = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, APPROVALS_TAB),
        ApprovalsTabActionId.RejectEntry,
        entry.id,
      );
      await t.db
        .updateTable('time_entries')
        .set({ status: TimeEntryStatus.Approved })
        .where('id', '=', entry.id)
        .execute();

      const response = await t.slack
        .submitView(workspace, manager, reject)
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'This time entry is no longer waiting for your approval.',
      );
      expect(await statusOf(entry)).toBe(TimeEntryStatus.Approved);
    });

    it("refuses a member's decision", async () => {
      const entry = await submitted(member);
      const confirmation = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, APPROVALS_TAB),
        ApprovalsTabActionId.ApproveAll,
      );

      const response = await t.slack
        .submitView(workspace, member, confirmation)
        .expect(200);

      expect(response.body.view.title.text).toBe('Forbidden');
      expect(await statusOf(entry)).toBe(TimeEntryStatus.Submitted);
    });
  });
});
