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

    it('tells the approvers what was submitted, in one message each', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      await workspace.addTimeEntry(member, website, { minutes: 120 });
      await workspace.addTimeEntry(member, website, { minutes: 60 });
      await workspace.addTimeEntry(opsMember, website, { minutes: 30 });
      const since = t.slackApi.mark();
      const messagesTo = (user: Tables<'users'>) =>
        t.slackApi
          .postedMessages(workspace.token, user.slack_id, { since })
          .map(({ text }) => text);

      for (const owner of [member, opsMember]) {
        await actOnTab(
          t,
          workspace,
          owner,
          await openAppHomeTab(t, workspace, owner),
          HomeTabActionId.SubmitTimeEntries,
        );
      }
      await t.idle();

      expect(messagesTo(manager)).toEqual([
        ':inbox_tray: *Mia Member* submitted *2 time entries* (3h) for your approval: Website (3h).\nThey wait for you in Logbook → ✅ Approvals.',
      ]);
      // Ops has no manager: HR hears of its people's entries.
      expect(messagesTo(hr)).toEqual([
        expect.stringContaining(
          'submitted *1 time entry* (30m) for your approval: Website (30m).',
        ),
      ]);
    });

    describe('for HR and admins', () => {
      // Kickoff waits for Design's manager; the others nobody else decides:
      // Ops has no manager, the manager's own entry has no other approver,
      // and Solo is in no team.
      const submitAll = async (hr?: Tables<'users'>) => {
        const solo = await workspace.addUser({ name: 'Sol Solo' });
        await submitted(member, { description: 'Kickoff' });
        await submitted(opsMember, { description: 'Ops work' });
        await submitted(manager, { description: 'Manager work' });
        await submitted(solo, { description: 'Solo work' });
        if (hr) {
          await submitted(hr, { description: 'Own work' });
        }
      };
      const descriptions = (view: Parameters<typeof listItems>[0]) =>
        listItems(view)
          .map(({ fields }) => fields.Description)
          .sort();

      it("gives HR only the entries nobody else decides, and everyone else's on request", async () => {
        const hr = await workspace.addUser({ role: UserRole.HR });
        const admin = await workspace.addUser({ role: UserRole.Admin });
        await submitAll(hr);

        const approvals = await openAppHomeTab(t, workspace, hr, APPROVALS_TAB);
        expect(descriptions(approvals)).toEqual([
          'Manager work',
          'Ops work',
          'Solo work',
        ]);
        expect(buttonText(approvals, ApprovalsTabActionId.ApproveAll)).toBe(
          'Approve all (3)',
        );

        const all = await actOnTab(
          t,
          workspace,
          hr,
          approvals,
          ApprovalsTabActionId.ShowAllEntries,
        );
        expect(descriptions(all)).toEqual([
          'Kickoff',
          'Manager work',
          'Ops work',
          'Solo work',
        ]);
        expect(
          buttonText(all, ApprovalsTabActionId.ApproveAll),
        ).toBeUndefined();

        // With HR in the workspace, only HR's own entry waits for the admin:
        // nobody else has the HR role to decide it.
        expect(
          descriptions(
            await openAppHomeTab(t, workspace, admin, APPROVALS_TAB),
          ),
        ).toEqual(['Own work']);
      });

      it('gives the admins what nobody decides when nobody has the HR role', async () => {
        const admin = await workspace.addUser({ role: UserRole.Admin });
        await submitAll();

        expect(
          descriptions(
            await openAppHomeTab(t, workspace, admin, APPROVALS_TAB),
          ),
        ).toEqual(['Manager work', 'Ops work', 'Solo work']);
      });

      it("approves all of HR's inbox, and a manager's entry only one by one", async () => {
        const hr = await workspace.addUser({ role: UserRole.HR });
        await submitAll();
        const kickoff = (await workspace.rows('time_entries')).find(
          ({ description }) => description === 'Kickoff',
        )!;

        const form = await openModalFrom(
          t,
          workspace,
          hr,
          await openAppHomeTab(t, workspace, hr, APPROVALS_TAB),
          ApprovalsTabActionId.ApproveAll,
        );
        await t.slack.submitView(workspace, hr, form).expect(200);
        await t.idle();

        const statuses = Object.fromEntries(
          (await workspace.rows('time_entries')).map((entry) => [
            entry.description,
            entry.status,
          ]),
        );
        expect(statuses).toEqual({
          Kickoff: TimeEntryStatus.Submitted,
          'Ops work': TimeEntryStatus.Approved,
          'Manager work': TimeEntryStatus.Approved,
          'Solo work': TimeEntryStatus.Approved,
        });

        // For a manager who is away.
        const all = await actOnTab(
          t,
          workspace,
          hr,
          await openAppHomeTab(t, workspace, hr, APPROVALS_TAB),
          ApprovalsTabActionId.ShowAllEntries,
        );
        await actOnTab(
          t,
          workspace,
          hr,
          all,
          ApprovalsTabActionId.ApproveEntry,
          kickoff.id,
        );
        expect(await statusOf(kickoff)).toBe(TimeEntryStatus.Approved);
      });
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
      const entry = await submitted(member, { work_date: '2026-06-16' });
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
          `:x: ${manager.name} rejected your time entry: *Website* (Acme), 16 Jun 2026, 1h.`,
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
        Status: '❌ Rejected',
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
