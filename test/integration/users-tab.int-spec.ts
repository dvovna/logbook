import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { NO_TEAM_VALUE } from '@modules/slack/tabs/users/views/edit-user-modal.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  actionIdsOf,
  buttonText,
  listItems,
  modalError,
  sectionTexts,
  titlesOf,
  noticeOf,
} from './support/tab-readers';

// Home → People → Users.
const USERS_TAB = [NavigationActionId.People];

const titleOf = (user: Tables<'users'>) => user.name;

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

  describe('importing leave', () => {
    it.each([UserRole.Admin, UserRole.HR])(
      'offers %s the button',
      async (role) => {
        const user =
          role === UserRole.Admin
            ? admin
            : await workspace.addUser({ role: UserRole.HR });
        const tab = await openAppHomeTab(t, workspace, user, USERS_TAB);

        expect(actionIdsOf(tab)).toContain(UsersTabViewActionId.ImportLeave);
        expect(buttonText(tab, UsersTabViewActionId.ImportLeave)).toBe(
          '📥 Import leave',
        );
      },
    );

    it.each([UserRole.Manager, UserRole.Finance])(
      'is not offered to %s, and a forged click sends nothing',
      async (role) => {
        const other = await workspace.addUser({ role });
        const tab = await openAppHomeTab(t, workspace, other, [
          NavigationActionId.Home,
        ]);
        const since = t.slackApi.mark();

        await t.slack
          .interaction({
            type: 'block_actions',
            team: { id: workspace.slackId },
            user: { id: other.slack_id },
            trigger_id: 'trigger-forged',
            container: { type: 'view' },
            view: { team_id: workspace.slackId, ...tab },
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

        expect(t.slackApi.calls.slice(since)).toEqual([]);
      },
    );
  });

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
      expect(sectionTexts(adasHome)).toEqual([
        '*Your Logbook access is turned off*',
        'Ask an admin of this workspace to turn it back on, then try again.',
      ]);
    });

    it('activates a user again from the list with inactive users', async () => {
      await t.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', ada.id)
        .execute();
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

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, form, {
          role: UserRole.HR,
          team_id: ops.id,
          contract_start_date: '2024-03-01',
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Ada Lovelace updated.',
      );
      expect(await workspace.row('users', ada.id)).toMatchObject({
        role: UserRole.HR,
        team_id: ops.id,
        contract_start_date: '2024-03-01',
      });
    });

    it('takes a user out of their team with "No team"', async () => {
      const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

      const since = t.slackApi.mark();
      await t.slack
        .submitView(workspace, admin, form, { team_id: NO_TEAM_VALUE })
        .expect(200);

      expect((await workspace.row('users', ada.id)).team_id).toBeNull();
      expect(
        listItems(await publishedHome(t, workspace, admin, since)).find(
          ({ title }) => title === titleOf(ada),
        )?.fields,
      ).toEqual({ Role: 'Member' });
    });

    it("clears a user's contract start", async () => {
      await t.db
        .updateTable('users')
        .set({ contract_start_date: '2024-03-01' })
        .where('id', '=', ada.id)
        .execute();
      const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

      const since = t.slackApi.mark();
      await t.slack
        .submitView(workspace, admin, form, { contract_start_date: undefined })
        .expect(200);

      expect(
        (await workspace.row('users', ada.id)).contract_start_date,
      ).toBeNull();
      expect(
        listItems(await publishedHome(t, workspace, admin, since)).find(
          ({ title }) => title === titleOf(ada),
        )?.fields,
      ).toEqual({ Role: 'Member', Team: 'Design' });
    });

    it("refuses more carryover than the team's policy allows", async () => {
      await t.db
        .updateTable('vacation_policies')
        .set({ carryover_days: 3 })
        .where('id', '=', design.vacation_policy_id!)
        .execute();
      const form = await fromMenu(UsersTabViewActionId.EditUser, ada);

      const response = await t.slack
        .submitView(workspace, admin, form, { carryover_days: '4' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'Cannot set carryover days to 4. Maximum allowed is 3.',
      );
      expect((await workspace.row('users', ada.id)).carryover_days).toBe(0);
    });

    it('checks carryover against the team the user moves to', async () => {
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
    });
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
        '*🏖️ Annual leave*\n\nUsed: *5* days\nAvailable: *15* / Limit: *20* days',
        expect.stringMatching(/Sick leave\*\nUsed: \*2\* days$/),
      ]),
    );
  });

  describe('as a manager', () => {
    it('lists only the users of the teams they approve for', async () => {
      const titles = titlesOf(await openUsersTab(manager));

      expect(titles).toContain(titleOf(ada));
      expect(titles).not.toContain(titleOf(olga));
    });

    it('offers a manager only what a manager may do', async () => {
      const [adaRow] = listItems(await openUsersTab(manager)).filter(
        ({ title }) => title === titleOf(ada),
      );

      expect(adaRow.menuLabels).toEqual(['View Vacation Usage']);
    });
  });
});
