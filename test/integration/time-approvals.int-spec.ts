import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeApprovalsTabActionId } from '@modules/slack/tabs/time-approvals/enums/time-approvals-tab-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  buttonText,
  listItems,
  modalError,
  sectionTexts,
} from './support/tab-readers';
import { addDays } from './support/dates';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Home → Time & Billing → Approvals.
const APPROVALS_TAB = [
  AdminNavigationActionId.ManageTimeAndBilling,
  AdminNavigationActionId.ManageTimeApprovals,
];

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
      .from('users')
      .update({ team_id: design.id })
      .eq('id', manager.id);
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

      const timeAndBilling = await openAppHomeTab(t, workspace, manager, [
        AdminNavigationActionId.ManageTimeAndBilling,
      ]);
      expect(sectionTexts(timeAndBilling)).toContain(
        '*✅ Approvals (1)*\n\nSubmitted time entries waiting for your decision',
      );

      const approvals = await actOnTab(
        t,
        workspace,
        manager,
        timeAndBilling,
        AdminNavigationActionId.ManageTimeApprovals,
      );
      expect(listItems(approvals)).toEqual([
        expect.objectContaining({
          title: 'Mia Member',
          fields: expect.objectContaining({ Description: 'Kickoff' }),
          buttons: [
            TimeApprovalsTabActionId.ApproveEntry,
            TimeApprovalsTabActionId.RejectEntry,
          ],
        }),
      ]);
      expect(buttonText(approvals, TimeApprovalsTabActionId.ApproveAll)).toBe(
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
        TimeApprovalsTabActionId.ApproveEntry,
        entry.id,
      );

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        status: TimeEntryStatus.Approved,
        updated_by: manager.id,
      });
      expect(sectionTexts(updated)).toContain(
        '_Nothing is waiting for your approval._',
      );
    });

    it('rejects an entry and tells its owner why', async () => {
      const entry = await submitted(member, { work_date: '2026-11-02' });
      const reject = await openModalFrom(
        t,
        workspace,
        manager,
        await openAppHomeTab(t, workspace, manager, APPROVALS_TAB),
        TimeApprovalsTabActionId.RejectEntry,
        entry.id,
      );

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, manager, reject, { reason: 'Wrong project' })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        'The time entry has been rejected. Mia Member will get a message about it.',
      ]);
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
      ).toContain('_Nothing is waiting for your approval._');

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
        TimeApprovalsTabActionId.ApproveAll,
      );
      expect(sectionTexts(confirmation)).toEqual([
        '6 time entries waiting for you will be approved.',
      ]);

      const response = await t.slack
        .submitView(workspace, manager, confirmation)
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        '✅ 6 time entries approved.',
      ]);
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
        TimeApprovalsTabActionId.RejectEntry,
        entry.id,
      );
      await t.db
        .from('time_entries')
        .update({ status: TimeEntryStatus.Approved })
        .eq('id', entry.id);

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
        TimeApprovalsTabActionId.ApproveAll,
      );

      const response = await t.slack
        .submitView(workspace, member, confirmation)
        .expect(200);

      expect(response.body.view.title.text).toBe('Forbidden');
      expect(await statusOf(entry)).toBe(TimeEntryStatus.Submitted);
    });
  });
});
