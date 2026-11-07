import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  listItems,
  modalError,
  sectionTexts,
  titlesOf,
} from './support/tab-readers';

// Home → People → Users.
const USERS_TAB = [
  AdminNavigationActionId.ManagePeople,
  AdminNavigationActionId.ManageUsers,
];

const titleOf = (user: Tables<'users'>) => `*${user.name}* (${user.email})`;

describe('Users tab', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let design: Tables<'teams'>;
  let ops: Tables<'teams'>;
  let ada: Tables<'users'>;
  let olga: Tables<'users'>;

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
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Max Manager',
    });
    const policy = await workspace.addVacationPolicy({
      vacation_days: 20,
      working_days: 20,
    });
    design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [manager.slack_id],
      vacation_policy_id: policy.id,
    });
    ops = await workspace.addTeam({ name: 'Ops' });
    ada = await workspace.addUser({ name: 'Ada Lovelace', team_id: design.id });
    olga = await workspace.addUser({ name: 'Olga Ops', team_id: ops.id });
  });

  const openUsersTab = (user = admin) =>
    openAppHomeTab(t, workspace, user, USERS_TAB);

  const fromMenu = async (
    action: UsersTabViewActionId,
    user: Tables<'users'>,
    usersTab?: View,
  ) =>
    openModalFrom(
      t,
      workspace,
      admin,
      usersTab ?? (await openUsersTab()),
      UsersTabViewActionId.ManageUserMenu,
      `${action}:${user.id}`,
    );

  describe('deactivating', () => {
    it('deactivates a user, who then only sees an access notice', async () => {
      const confirmation = await fromMenu(
        UsersTabViewActionId.ChangeStatus,
        ada,
      );
      expect(sectionTexts(confirmation)).toEqual([
        'Are you sure you want to deactivate the user *Ada Lovelace*?',
      ]);

      const since = t.slackApi.mark();
      await t.slack.submitView(workspace, admin, confirmation).expect(200);

      expect((await workspace.row('users', ada.id)).is_active).toBe(false);
      expect(
        titlesOf(await publishedHome(t, workspace, admin, since)),
      ).not.toContain(titleOf(ada));

      const adasHome = await openAppHomeTab(t, workspace, ada);
      expect(sectionTexts(adasHome).join()).toContain(
        'Please reach out to your admin to get access',
      );
    });

    it('activates a user again from the list with inactive users', async () => {
      await t.db.from('users').update({ is_active: false }).eq('id', ada.id);
      const withInactive = await actOnTab(
        t,
        workspace,
        admin,
        await openUsersTab(),
        UsersTabViewActionId.IncludeInactive,
        YesNoValue.Yes,
      );
      expect(
        listItems(withInactive).find(({ title }) => title === titleOf(ada))
          ?.menuLabels,
      ).toEqual(['Activate User']);

      const confirmation = await fromMenu(
        UsersTabViewActionId.ChangeStatus,
        ada,
        withInactive,
      );
      await t.slack.submitView(workspace, admin, confirmation).expect(200);

      expect((await workspace.row('users', ada.id)).is_active).toBe(true);
    });
  });

  describe('editing', () => {
    it("changes a user's role, team and contract start", async () => {
      const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

      const response = await t.slack
        .submitView(workspace, admin, form, {
          role: UserRole.HR,
          team_id: ops.id,
          contract_start_date: '2024-03-01',
        })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ User 'Ada Lovelace' was updated successfully!",
      ]);
      expect(await workspace.row('users', ada.id)).toMatchObject({
        role: UserRole.HR,
        team_id: ops.id,
        contract_start_date: '2024-03-01',
      });
    });

    it("refuses more carryover than the team's policy allows", async () => {
      await t.db
        .from('vacation_policies')
        .update({ carryover_days: 3 })
        .eq('id', design.vacation_policy_id!);
      const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

      const response = await t.slack
        .submitView(workspace, admin, form, { carryover_days: '4' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'Cannot set carryover days to 4. Maximum allowed is 3.',
      );
      expect((await workspace.row('users', ada.id)).carryover_days).toBe(0);
    });

    // BUG: the carryover is checked against the policy of the team the user
    // is in before the edit (user-update-validator.service.ts,
    // validateCarryoverDays), not the team they move to: moving Ada from
    // Design (at most 0 days) to Ops (no policy) with 4 days is refused.
    it.failing(
      'checks carryover against the team the user moves to',
      async () => {
        const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

        await t.slack
          .submitView(workspace, admin, form, {
            team_id: ops.id,
            carryover_days: '4',
          })
          .expect(200);

        expect(await workspace.row('users', ada.id)).toMatchObject({
          team_id: ops.id,
          carryover_days: 4,
        });
      },
    );
  });

  it("shows a user's vacation usage under their policy", async () => {
    await workspace.addVacationRequest(ada, {
      start_date: '2026-03-02',
      end_date: '2026-03-06',
      days: 5,
      working_days: 5,
    });
    await workspace.addVacationRequest(ada, {
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      type: 'sick_leave',
      days: 2,
      working_days: 2,
    });

    const usage = await fromMenu(UsersTabViewActionId.ViewVacationUsage, ada);

    expect(sectionTexts(usage)).toEqual(
      expect.arrayContaining([
        '*📅 Annual Leave*\n\nUsed: *5* days\nAvailable: *15* / Limit: *20* days',
        expect.stringMatching(/Sick Leave\*\nUsed: \*2\* days$/),
      ]),
    );
  });

  describe('as a manager', () => {
    it('lists only the users of the teams they approve for', async () => {
      const titles = titlesOf(await openUsersTab(manager));

      expect(titles).toContain(titleOf(ada));
      expect(titles).not.toContain(titleOf(olga));
    });

    // BUG?: a manager's menu offers Edit User and Deactivate User
    // (users-tab.view.ts, getUserRowAccessory), but only Admin and HR may
    // submit those forms (edit-user-form-submit.handler.ts,
    // change-user-status-form-submit.handler.ts), so the manager ends up on
    // "not allowed".
    it.failing('offers a manager only what a manager may do', async () => {
      const [adaRow] = listItems(await openUsersTab(manager)).filter(
        ({ title }) => title === titleOf(ada),
      );

      expect(adaRow.menuLabels).toEqual(['View Vacation Usage']);
    });
  });
});
