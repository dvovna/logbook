import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { PolicyTabViewActionId } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { modalError, sectionTexts } from './support/tab-readers';

// Home → Vacations → Vacation Policies.
const POLICIES_TAB = [
  AdminNavigationActionId.ManageVacations,
  AdminNavigationActionId.ManageVacationPolicies,
];

// Home → People → Teams.
const TEAMS_TAB = [
  AdminNavigationActionId.ManagePeople,
  AdminNavigationActionId.ManageTeams,
];

describe('Vacation policies and teams', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

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
  });

  const openModal = async (path: string[], actionId: string, value?: string) =>
    openModalFrom(
      t,
      workspace,
      admin,
      await openAppHomeTab(t, workspace, admin, path),
      actionId,
      value,
    );

  describe('vacation policies', () => {
    it('creates a policy', async () => {
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );

      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Berlin',
          vacation_days: '28',
          working_days: '20',
          bonus_days: '2',
          carryover_days: '5',
        })
        .expect(200);

      expect(response.body.response_action).toBe('update');
      expect(await workspace.rows('vacation_policies')).toEqual([
        expect.objectContaining({
          name: 'Berlin',
          vacation_days: 28,
          working_days: 20,
          bonus_days: 2,
          carryover_days: 5,
        }),
      ]);
    });

    it('changes a policy', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Berlin' });
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.ManagePolicyMenu,
        `${PolicyTabViewActionId.EditPolicy}:${policy.id}`,
      );
      expect(findAction(form.blocks, 'name').element.initial_value).toBe(
        'Berlin',
      );

      await t.slack
        .submitView(workspace, admin, form, {
          name: 'Berlin 2027',
          vacation_days: '30',
        })
        .expect(200);

      expect(await workspace.row('vacation_policies', policy.id)).toMatchObject(
        {
          name: 'Berlin 2027',
          vacation_days: 30,
        },
      );
    });

    it('rejects days that are not a number', async () => {
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );

      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Berlin',
          vacation_days: 'many',
        })
        .expect(200);

      expect(response.body.response_action).toBe('errors');
      expect(Object.keys(response.body.errors)).toEqual([
        'vacation_days_block',
      ]);
      expect(await workspace.rows('vacation_policies')).toEqual([]);
    });

    it('deletes a policy no team uses, and refuses one in use', async () => {
      const unused = await workspace.addVacationPolicy({ name: 'Unused' });
      const used = await workspace.addVacationPolicy({ name: 'Used' });
      await workspace.addTeam({ vacation_policy_id: used.id });
      const deleteThe = async (policy: Tables<'vacation_policies'>) => {
        const confirmation = await openModal(
          POLICIES_TAB,
          PolicyTabViewActionId.ManagePolicyMenu,
          `${PolicyTabViewActionId.DeletePolicy}:${policy.id}`,
        );

        return t.slack.submitView(workspace, admin, confirmation).expect(200);
      };

      await deleteThe(unused);
      const refused = await deleteThe(used);

      expect(modalError(refused.body.view)).toBe(
        'This policy has dependencies (used by 1 team) and cannot be deleted.',
      );
      expect(
        (await workspace.rows('vacation_policies')).map(({ name }) => name),
      ).toEqual(['Used']);
    });
  });

  describe('teams', () => {
    it('creates a team with its policy, approvers and rules', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Berlin' });
      const manager = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Max Manager',
      });
      const hr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Hana HR',
      });
      await workspace.addUser({ name: 'Mia Member' });
      const form = await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam);

      // Members cannot approve: only managers and admins, or HR and admins.
      const optionsOf = (actionId: string) =>
        findAction(form.blocks, actionId)
          .element.options.map(({ value }: { value: string }) => value)
          .sort();
      expect(optionsOf('manager_approvers')).toEqual(
        [admin.slack_id, manager.slack_id].sort(),
      );
      expect(optionsOf('hr_approvers')).toEqual(
        [admin.slack_id, hr.slack_id].sort(),
      );

      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Design',
          description: 'Product design',
          policy: policy.id,
          manager_approvers: [manager.slack_id, admin.slack_id],
          manager_approvers_rule: [ApprovalRule.All],
          hr_approvers: [hr.slack_id],
          approval_notification_recipients: [admin.slack_id],
        })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ Team 'Design' was created successfully!",
      ]);
      expect(await workspace.rows('teams')).toEqual([
        expect.objectContaining({
          name: 'Design',
          description: 'Product design',
          vacation_policy_id: policy.id,
          manager_approvers: [manager.slack_id, admin.slack_id],
          manager_approvers_rule: ApprovalRule.All,
          hr_approvers: [hr.slack_id],
          hr_approvers_rule: ApprovalRule.Any,
          approval_notification_recipients: [admin.slack_id],
        }),
      ]);
    });

    it('changes a team and takes its approvers away', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const team = await workspace.addTeam({
        name: 'Design',
        manager_approvers: [manager.slack_id],
        manager_approvers_rule: ApprovalRule.All,
      });
      const form = await openModal(
        TEAMS_TAB,
        TeamsTabViewActionId.ManageTeamMenu,
        `${TeamsTabViewActionId.EditTeam}:${team.id}`,
      );

      await t.slack
        .submitView(workspace, admin, form, {
          name: 'Product Design',
          manager_approvers: [],
          manager_approvers_rule: [],
        })
        .expect(200);

      expect(await workspace.row('teams', team.id)).toMatchObject({
        name: 'Product Design',
        manager_approvers: [],
        manager_approvers_rule: ApprovalRule.Any,
      });
    });

    it('refuses a second team with the same name', async () => {
      await workspace.addTeam({ name: 'Design' });
      const form = await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam);

      const response = await t.slack
        .submitView(workspace, admin, form, { name: 'Design' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        "Team with name 'Design' already exists.",
      );
      expect(await workspace.rows('teams')).toHaveLength(1);
    });
  });
});
