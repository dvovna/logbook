import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import {
  TeamModalActionId,
  TeamsTabViewActionId,
} from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { NO_POLICY_VALUE } from '@modules/slack/tabs/teams/constants/no-policy';
import { View } from '@slack/types/dist/views';
import { PolicyTabViewActionId } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { createTestApp, ITestApp } from './support/test-app';
import { chooseTeamRules } from './support/team-form';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  listItems,
  modalError,
  sectionTexts,
  noticeOf,
  buttonText,
  actionIdsOf,
} from './support/tab-readers';

// Home → Vacations → Vacation Policies.
const POLICIES_TAB = [NavigationActionId.Policies];

// Home → People → Teams.
const TEAMS_TAB = [NavigationActionId.Teams];

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

  const chooseRules = (form: View, rules: TeamRulesChoice) =>
    chooseTeamRules(t, workspace, admin, form, rules);

  describe('vacation policies', () => {
    it('creates a policy', async () => {
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Berlin',
          vacation_days: '28',
          working_days: '20',
          bonus_days: '2',
          carryover_days: '5',
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Policy Berlin created. It applies to everyone: the company rules use it. Next: its public holidays, with 🎉 Holidays.',
      );
      const [berlin] = await workspace.rows('vacation_policies');
      expect(
        (await t.app.get(CompanyRulesService).get(workspace.id))
          .vacation_policy_id,
      ).toBe(berlin.id);
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

    // The company rules keep the policy they name: a second one waits for
    // someone to choose it.
    it('leaves a second policy to be chosen', async () => {
      const first = await workspace.addVacationPolicy({ name: 'Berlin' });
      await t.app
        .get(CompanyRulesService)
        .adoptPolicyIfNone(workspace.id, first.id);
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, admin, form, {
          name: 'Lisbon',
          vacation_days: '22',
          working_days: '22',
          bonus_days: '0',
          carryover_days: '0',
        })
        .expect(200);

      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Policy Lisbon created. Choose it in the company rules or a team to apply it. Next: its public holidays, with 🎉 Holidays.',
      );
      expect(
        (await t.app.get(CompanyRulesService).get(workspace.id))
          .vacation_policy_id,
      ).toBe(first.id);
    });

    // Company rules on No Policy with policies around were chosen so: a new
    // policy, meant for a team, leaves them as they are.
    it('keeps company rules left on No Policy when another policy is created', async () => {
      await workspace.addVacationPolicy({ name: 'Berlin' });
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, admin, form, {
          name: 'Lisbon',
          vacation_days: '22',
          working_days: '22',
          bonus_days: '0',
          carryover_days: '0',
        })
        .expect(200);

      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Policy Lisbon created. Choose it in the company rules or a team to apply it. Next: its public holidays, with 🎉 Holidays.',
      );
      expect(
        (await t.app.get(CompanyRulesService).get(workspace.id))
          .vacation_policy_id,
      ).toBeNull();
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

    it('takes a generous policy, up to 60 days a field', async () => {
      const submit = async (vacationDays: string) =>
        t.slack
          .submitView(
            workspace,
            admin,
            await openModal(POLICIES_TAB, PolicyTabViewActionId.AddPolicy),
            {
              name: `Generous ${vacationDays}`,
              vacation_days: vacationDays,
              working_days: '33',
              bonus_days: '10',
              carryover_days: '35',
            },
          )
          .expect(200);

      expect((await submit('45')).body).toEqual({ response_action: 'clear' });
      expect((await submit('61')).body).toEqual({
        response_action: 'errors',
        errors: { vacation_days_block: 'Calendar days cannot exceed 60' },
      });
      expect(await workspace.rows('vacation_policies')).toEqual([
        expect.objectContaining({
          vacation_days: 45,
          working_days: 33,
          bonus_days: 10,
          carryover_days: 35,
        }),
      ]);
    });

    it('asks for at least one working day, as the database does', async () => {
      const form = await openModal(
        POLICIES_TAB,
        PolicyTabViewActionId.AddPolicy,
      );

      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Berlin',
          vacation_days: '0',
          working_days: '0',
        })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { working_days_block: 'Working days must be at least 1' },
      });
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

  // What the lists say about a team and its policy, by name.
  it('shows who approves and who is in a team, and what a policy allows', async () => {
    const manager = await workspace.addUser({ role: UserRole.Manager });
    const hr = await workspace.addUser({ role: UserRole.HR });
    const policy = await workspace.addVacationPolicy({
      name: 'Standard',
      vacation_days: 26,
      working_days: 20,
      bonus_days: 2,
      carryover_days: 5,
    });
    const team = await workspace.addTeam({
      name: 'Design',
      vacation_policy_id: policy.id,
      manager_approvers: [manager.slack_id],
      hr_approvers: [hr.slack_id],
      hr_approvers_rule: ApprovalRule.All,
    });
    for (const name of ['Bob Builder', 'Ada Lovelace']) {
      await workspace.addUser({ name, team_id: team.id });
    }

    const [teamItem] = listItems(
      await openAppHomeTab(t, workspace, admin, TEAMS_TAB),
    );
    expect(teamItem.fields).toMatchObject({
      Rules: 'own',
      Approvers: `team <@${manager.slack_id}> (any one), then HR <@${hr.slack_id}> (all)`,
      Members: '2 (Ada Lovelace, Bob Builder)',
    });

    const [policyItem] = listItems(
      await openAppHomeTab(t, workspace, admin, POLICIES_TAB),
    );
    expect(policyItem.fields).toMatchObject({
      'Annual leave a year':
        '26 calendar days, at most 20 of them working days',
      'Bonus days a year': '2',
      Carryover: 'up to 5 days from the previous year',
      'Used by': 'Design',
    });
  });

  describe('teams', () => {
    it('offers company rules next to Add Team, and a new team starts on them', async () => {
      const tab = await openAppHomeTab(t, workspace, admin, TEAMS_TAB);

      expect(
        [TeamsTabViewActionId.AddTeam, TeamsTabViewActionId.CompanyRules].map(
          (actionId) => buttonText(tab, actionId),
        ),
      ).toEqual(['➕ Add Team', '⚙️ Company rules']);

      const form = await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam);

      expect(
        findAction(form.blocks, TeamModalActionId.Rules).element,
      ).toMatchObject({ initial_option: { value: TeamRulesChoice.Company } });
      expect(actionIdsOf(form)).not.toContain('policy');
    });

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
      const mia = await workspace.addUser({ name: 'Mia Member' });
      await workspace.addUser({ role: UserRole.Finance, name: 'Mia Finance' });
      const miaHr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Mia HR',
      });
      const newTeamForm = await openModal(
        TEAMS_TAB,
        TeamsTabViewActionId.AddTeam,
      );
      const form = await chooseRules(newTeamForm, TeamRulesChoice.Own);

      // Members, Managers and Admins, as the team file takes its leads: not
      // Finance, which approves nothing, nor HR, who decides later levels.
      // The second approval takes HR and admins.
      const suggested = await t.slack
        .suggest(workspace, admin, form, TeamModalActionId.Approvers, 'mia')
        .expect(acknowledged);
      expect(suggested.body.options).toEqual([
        {
          text: { type: 'plain_text', text: 'Mia Member' },
          value: mia.slack_id,
        },
      ]);
      expect(
        findAction(form.blocks, 'hr_approvers')
          .element.options.map(({ value }: { value: string }) => value)
          .sort(),
      ).toEqual([admin.slack_id, hr.slack_id, miaHr.slack_id].sort());

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, form, {
          name: 'Design',
          description: 'Product design',
          policy: policy.id,
          manager_approvers: [manager.slack_id, mia.slack_id],
          manager_approvers_rule: [ApprovalRule.All],
          hr_approvers: [hr.slack_id],
          approval_notification_recipients: [admin.slack_id],
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Team Design created. Now Managers, to approve its time off: Mia Member.',
      );
      expect((await workspace.row('users', mia.id)).role).toBe(
        UserRole.Manager,
      );
      expect(await workspace.rows('teams')).toEqual([
        expect.objectContaining({
          name: 'Design',
          description: 'Product design',
          vacation_policy_id: policy.id,
          manager_approvers: [manager.slack_id, mia.slack_id],
          manager_approvers_rule: ApprovalRule.All,
          hr_approvers: [hr.slack_id],
          hr_approvers_rule: ApprovalRule.Any,
          approval_notification_recipients: [admin.slack_id],
          rule_set_id: null,
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

    // A lead made a Member since still shows, so renaming the team doesn't
    // drop them unseen; saving makes them a Manager again.
    it("keeps an approver who became a Member in the team's form", async () => {
      const lee = await workspace.addUser({ name: 'Lee Lead' });
      const team = await workspace.addTeam({
        name: 'Design',
        manager_approvers: [lee.slack_id],
      });
      const form = await openModal(
        TEAMS_TAB,
        TeamsTabViewActionId.ManageTeamMenu,
        `${TeamsTabViewActionId.EditTeam}:${team.id}`,
      );

      expect(
        findAction(form.blocks, TeamModalActionId.Approvers).element
          .initial_options,
      ).toEqual([
        { text: { type: 'plain_text', text: 'Lee Lead' }, value: lee.slack_id },
      ]);

      await t.slack
        .submitView(workspace, admin, form, { name: 'Product Design' })
        .expect(200);

      expect(await workspace.row('teams', team.id)).toMatchObject({
        name: 'Product Design',
        manager_approvers: [lee.slack_id],
      });
      expect((await workspace.row('users', lee.id)).role).toBe(
        UserRole.Manager,
      );
    });

    // Slack takes the chosen options from the client.
    it('refuses a team approver the search never offers', async () => {
      const finance = await workspace.addUser({ role: UserRole.Finance });
      const form = await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam);

      const response = await t.slack
        .submitView(
          workspace,
          admin,
          form,
          { name: 'Design' },
          {
            manager_approvers_block: {
              manager_approvers: {
                type: 'multi_external_select',
                selected_options: [
                  {
                    text: { type: 'plain_text', text: finance.name },
                    value: finance.slack_id,
                  },
                ],
              },
            },
          },
        )
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: {
          manager_approvers_block:
            "A team's approvers need to be active people without the Finance role.",
        },
      });
      expect(await workspace.rows('teams')).toEqual([]);
    });

    // "No Policy" is the one way to have none: the field is required, so
    // Slack adds no "Clear selection" that would mean the same.
    it('takes a policy away with No Policy', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Berlin' });
      const team = await workspace.addTeam({ vacation_policy_id: policy.id });
      const policyBlockOf = (view: View) =>
        view.blocks.find(({ block_id }) =>
          block_id?.startsWith('policy_block'),
        ) as {
          optional?: boolean;
          element: { initial_option?: { value: string } };
        };

      const newTeamForm = await chooseRules(
        await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam),
        TeamRulesChoice.Own,
      );
      expect(policyBlockOf(newTeamForm).optional).toBeUndefined();
      expect(policyBlockOf(newTeamForm).element.initial_option?.value).toBe(
        NO_POLICY_VALUE,
      );

      const form = await openModal(
        TEAMS_TAB,
        TeamsTabViewActionId.ManageTeamMenu,
        `${TeamsTabViewActionId.EditTeam}:${team.id}`,
      );
      expect(policyBlockOf(form).element.initial_option?.value).toBe(policy.id);

      await t.slack
        .submitView(workspace, admin, form, { policy: NO_POLICY_VALUE })
        .expect(200);

      expect((await workspace.row('teams', team.id)).vacation_policy_id).toBe(
        null,
      );
    });

    it('refuses a second team with the same name', async () => {
      await workspace.addTeam({ name: 'Design' });
      const form = await openModal(TEAMS_TAB, TeamsTabViewActionId.AddTeam);

      const response = await t.slack
        .submitView(workspace, admin, form, { name: 'Design' })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { name_block: "Team with name 'Design' already exists." },
      });
      expect(await workspace.rows('teams')).toHaveLength(1);
    });
  });
});
