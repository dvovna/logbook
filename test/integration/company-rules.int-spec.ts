import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { formatDateRange } from '@common/utils/date.utils';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { PolicyTabViewActionId } from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import {
  CompanyRulesService,
  ICompanyRulesParams,
} from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { addDays, workWeek } from './support/dates';
import { textOf } from './support/block-kit';
import {
  actionIdsOf,
  listItems,
  modalError,
  noticeOf,
  sectionTexts,
} from './support/tab-readers';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { findAction } from './support/block-kit';
import {
  TeamModalActionId,
  TeamsTabViewActionId,
} from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { TeamRulesChoice } from '@modules/slack/tabs/teams/enums/team-rules-choice.enum';
import { View } from '@slack/types/dist/views';
import {
  approvalMessageTo,
  requestVacation,
  submitVacationRequest,
} from './support/vacation-flows';

// The company rules (level 2 approvers, who hears of decisions, the vacation
// policy) apply to the teams that follow them and to everyone in no team.
describe('Company rules', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let lead: Tables<'users'>;
  let hr: Tables<'users'>;
  let officeManager: Tables<'users'>;

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
    lead = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Liam Lead',
    });
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    officeManager = await workspace.addUser({ name: 'Olga Office' });
  });

  // Set directly, for the tests that don't go through the form.
  const setCompanyRules = (rules: Partial<ICompanyRulesParams>) =>
    t.app.get(CompanyRulesService).update(
      workspace.id,
      {
        hrApprovers: [],
        hrApproversRule: ApprovalRule.Any,
        notificationRecipients: [],
        vacationPolicyId: null,
        ...rules,
      },
      admin as unknown as IUserViewModel,
    );

  // What a team that follows the company rules has in rule_set_id.
  const companyRuleSetId = async () =>
    (await t.app.get(CompanyRulesService).get(workspace.id)).id;

  const messagesTo = async (user: Tables<'users'>) => {
    await t.idle();

    return t.slackApi.postedMessages(workspace.token, user.slack_id);
  };

  const approve = async (approver: Tables<'users'>) =>
    t.slack
      .actOnMessage(
        workspace,
        approver,
        await approvalMessageTo(t, workspace, approver),
        ApproverMessageActionId.Approve,
      )
      .expect(200);

  const statusOf = async (request: Tables<'vacation_requests'>) => {
    await t.idle();

    return (await workspace.row('vacation_requests', request.id)).status;
  };

  // Each approver of the request's workflow: level, level name, Slack ID.
  const levelsOf = async (request: Tables<'vacation_requests'>) =>
    (await workspace.rows('request_workflow_steps'))
      .filter(({ request_id }) => request_id === request.id)
      .sort((a, b) => a.step_level - b.step_level)
      .map(({ step_level, step_data, slack_user_id }) => [
        step_level,
        (step_data as { level_name?: string }).level_name,
        slack_user_id,
      ]);

  it("a request in a team that follows company rules goes to its lead, then to the company's level 2, and the company's recipients hear of the decision", async () => {
    const ownHr = await workspace.addUser({
      role: UserRole.HR,
      name: 'Otto Own HR',
    });
    const ownRecipient = await workspace.addUser({ name: 'Rita Recipient' });
    await setCompanyRules({
      hrApprovers: [hr.slack_id],
      notificationRecipients: [officeManager.slack_id],
    });
    // The team still holds what it had before it followed the company rules.
    const team = await workspace.addTeam({
      rule_set_id: await companyRuleSetId(),
      manager_approvers: [lead.slack_id],
      hr_approvers: [ownHr.slack_id],
      approval_notification_recipients: [ownRecipient.slack_id],
    });
    const member = await workspace.addUser({
      name: 'Max Member',
      team_id: team.id,
    });

    const request = await requestVacation(t, workspace, member, workWeek(2));
    await approve(lead);
    await approve(hr);

    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    expect(await levelsOf(request)).toEqual([
      [1, 'Manager approval', lead.slack_id],
      [2, 'HR approval', hr.slack_id],
    ]);
    const [notice] = await messagesTo(officeManager);
    expect(textOf(notice)).toContain('Max Member');
    expect(await messagesTo(ownHr)).toEqual([]);
    expect(await messagesTo(ownRecipient)).toEqual([]);
  });

  it("a request by someone in no team goes to the company's level 2 and is limited by the company policy", async () => {
    const policy = await workspace.addVacationPolicy({
      vacation_days: 3,
      working_days: 20,
    });
    const otherHr = await workspace.addUser({
      role: UserRole.HR,
      name: 'Otto Other HR',
    });
    await setCompanyRules({
      hrApprovers: [hr.slack_id],
      notificationRecipients: [officeManager.slack_id],
      vacationPolicyId: policy.id,
    });
    const member = await workspace.addUser({ name: 'Max Member' });

    expect(
      await submitVacationRequest(t, workspace, member, workWeek(1)),
    ).toEqual({
      response_action: 'errors',
      errors: {
        end_date_block: 'Not enough vacation days. Requested: 5, available: 3',
      },
    });

    const { start } = workWeek(2);
    const end = addDays(start, 1);
    const request = await requestVacation(t, workspace, member, {
      start,
      end,
    });

    expect(textOf(await approvalMessageTo(t, workspace, hr))).toContain(
      'Max Member',
    );
    expect(await messagesTo(otherHr)).toEqual([]);
    expect(await messagesTo(admin)).toEqual([]);
    expect((await messagesTo(member)).map(({ text }) => text)).toEqual([
      `📨 Your vacation request (${formatDateRange(start, end)}) went to <@${hr.slack_id}> (HR approval).`,
    ]);

    await approve(hr);

    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    const [notice] = await messagesTo(officeManager);
    expect(textOf(notice)).toContain('Max Member');
  });

  it('with no level 2 in the company rules a teamless request goes to HR, else the admins', async () => {
    await setCompanyRules({ notificationRecipients: [officeManager.slack_id] });
    const member = await workspace.addUser({ name: 'Max Member' });
    const first = workWeek(1);

    await requestVacation(t, workspace, member, first);

    expect(await approvalMessageTo(t, workspace, hr)).toBeDefined();
    expect(await messagesTo(admin)).toEqual([]);
    expect((await messagesTo(member)).map(({ text }) => text)).toEqual([
      `📨 Your vacation request (${formatDateRange(first.start, first.end)}) went to HR for approval: you are not in a team.`,
    ]);

    // Nobody has the HR role anymore.
    await t.db
      .updateTable('users')
      .set({ role: UserRole.Member })
      .where('id', '=', hr.id)
      .execute();
    const second = workWeek(2);

    await requestVacation(t, workspace, member, second);

    expect(await approvalMessageTo(t, workspace, admin)).toBeDefined();
    expect((await messagesTo(member)).map(({ text }) => text)).toEqual([
      `📨 Your vacation request (${formatDateRange(first.start, first.end)}) went to HR for approval: you are not in a team.`,
      `📨 Your vacation request (${formatDateRange(second.start, second.end)}) went to the workspace admins for approval: you are not in a team.`,
    ]);
  });

  it('sends a teamless request to the admins when the company rules name only its requester', async () => {
    await setCompanyRules({ hrApprovers: [hr.slack_id] });
    const { start, end } = workWeek(2);

    await requestVacation(t, workspace, hr, { start, end });

    expect(await approvalMessageTo(t, workspace, admin)).toBeDefined();
    expect((await messagesTo(hr)).map(({ text }) => text)).toEqual([
      `📨 Your vacation request (${formatDateRange(start, end)}) went to the workspace admins for approval: you are not in a team.`,
    ]);
  });

  it('a team with its own rules ignores the company rules', async () => {
    const companyPolicy = await workspace.addVacationPolicy({
      vacation_days: 3,
      working_days: 20,
    });
    const ownPolicy = await workspace.addVacationPolicy({
      vacation_days: 20,
      working_days: 20,
    });
    const ownHr = await workspace.addUser({
      role: UserRole.HR,
      name: 'Otto Own HR',
    });
    const ownRecipient = await workspace.addUser({ name: 'Rita Recipient' });
    await setCompanyRules({
      hrApprovers: [hr.slack_id],
      notificationRecipients: [officeManager.slack_id],
      vacationPolicyId: companyPolicy.id,
    });
    const team = await workspace.addTeam({
      manager_approvers: [lead.slack_id],
      hr_approvers: [ownHr.slack_id],
      approval_notification_recipients: [ownRecipient.slack_id],
      vacation_policy_id: ownPolicy.id,
    });
    const member = await workspace.addUser({
      name: 'Max Member',
      team_id: team.id,
    });

    // Five days: more than the company policy's three.
    const request = await requestVacation(t, workspace, member, workWeek(1));
    await approve(lead);
    await approve(ownHr);

    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    expect(await levelsOf(request)).toEqual([
      [1, 'Manager approval', lead.slack_id],
      [2, 'HR approval', ownHr.slack_id],
    ]);
    const [notice] = await messagesTo(ownRecipient);
    expect(textOf(notice)).toContain('Max Member');
    expect(await messagesTo(hr)).toEqual([]);
    expect(await messagesTo(officeManager)).toEqual([]);
  });

  it('a request already waiting keeps its approvers after the company rules change', async () => {
    const newHr = await workspace.addUser({
      role: UserRole.HR,
      name: 'Nina New HR',
    });
    const newRecipient = await workspace.addUser({ name: 'Nora New' });
    await setCompanyRules({
      hrApprovers: [hr.slack_id],
      notificationRecipients: [officeManager.slack_id],
    });
    const team = await workspace.addTeam({
      rule_set_id: await companyRuleSetId(),
      manager_approvers: [lead.slack_id],
    });
    const member = await workspace.addUser({
      name: 'Max Member',
      team_id: team.id,
    });

    const request = await requestVacation(t, workspace, member, workWeek(2));
    // The workflow starts in a job after the form closes.
    await t.idle();
    await setCompanyRules({
      hrApprovers: [newHr.slack_id],
      notificationRecipients: [newRecipient.slack_id],
    });
    await approve(lead);
    await approve(hr);

    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    expect(await messagesTo(newHr)).toEqual([]);
    // Who hears of the decision is read when it is made.
    const [notice] = await messagesTo(newRecipient);
    expect(textOf(notice)).toContain('Max Member');
    expect(await messagesTo(officeManager)).toEqual([]);
  });

  describe('the vacation policy', () => {
    const POLICIES_TAB = [NavigationActionId.Policies];

    const deletePolicy = async (policy: Tables<'vacation_policies'>) => {
      const confirmation = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, POLICIES_TAB),
        PolicyTabViewActionId.ManagePolicyMenu,
        `${PolicyTabViewActionId.DeletePolicy}:${policy.id}`,
      );

      return t.slack.submitView(workspace, admin, confirmation).expect(200);
    };

    it('a policy used by the company rules cannot be deleted', async () => {
      const companyPolicy = await workspace.addVacationPolicy({
        name: 'Company',
      });
      const stale = await workspace.addVacationPolicy({ name: 'Stale' });
      await setCompanyRules({ vacationPolicyId: companyPolicy.id });
      // What a team had before it followed the company rules doesn't count.
      await workspace.addTeam({
        rule_set_id: await companyRuleSetId(),
        vacation_policy_id: stale.id,
      });

      const refused = await deletePolicy(companyPolicy);
      const deleted = await deletePolicy(stale);

      expect(modalError(refused.body.view)).toBe(
        'The company rules use this policy. Choose another policy there first.',
      );
      expect(deleted.body).toEqual({ response_action: 'clear' });
      expect(
        (await workspace.rows('vacation_policies')).map(({ name }) => name),
      ).toEqual(['Company']);
    });

    it('lists the company rules and the teams that follow them under the company policy', async () => {
      const companyPolicy = await workspace.addVacationPolicy({
        name: 'Company',
      });
      const ownPolicy = await workspace.addVacationPolicy({ name: 'Own' });
      await setCompanyRules({ vacationPolicyId: companyPolicy.id });
      await workspace.addTeam({
        name: 'Design',
        rule_set_id: await companyRuleSetId(),
        vacation_policy_id: ownPolicy.id,
      });
      await workspace.addTeam({
        name: 'Ops',
        vacation_policy_id: ownPolicy.id,
      });

      const items = listItems(
        await openAppHomeTab(t, workspace, admin, POLICIES_TAB),
      );

      expect(
        items.map(({ title, fields }) => [title, fields['Used by']]),
      ).toEqual([
        ['Company', 'Company rules, Design'],
        ['Own', 'Ops'],
      ]);
    });

    it('limits the carryover of someone in no team', async () => {
      const policy = await workspace.addVacationPolicy({ carryover_days: 3 });
      await setCompanyRules({ vacationPolicyId: policy.id });
      const member = await workspace.addUser({ name: 'Max Member' });
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, [NavigationActionId.People]),
        UsersTabViewActionId.ManageUserMenu,
        `${UsersTabViewActionId.EditUser}:${member.id}`,
      );

      const response = await t.slack
        .submitView(workspace, admin, form, { carryover_days: '4' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'Cannot set carryover days to 4. Maximum allowed is 3.',
      );
    });

    it('says on Home when no vacation policy applies', async () => {
      const member = await workspace.addUser({ name: 'Max Member' });

      expect(
        sectionTexts(await openAppHomeTab(t, workspace, member)).filter(
          (text) => text.startsWith('Annual leave'),
        ),
      ).toEqual(['Annual leave: no limit (no vacation policy applies to you)']);
    });
  });

  describe('on Teams', () => {
    const TEAMS_TAB = [NavigationActionId.Teams];

    const openCompanyRules = async (user: Tables<'users'>) =>
      openModalFrom(
        t,
        workspace,
        user,
        await openAppHomeTab(t, workspace, user, TEAMS_TAB),
        TeamsTabViewActionId.CompanyRules,
      );

    const openTeamForm = async (team?: Tables<'teams'>) =>
      openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, TEAMS_TAB),
        team
          ? TeamsTabViewActionId.ManageTeamMenu
          : TeamsTabViewActionId.AddTeam,
        team && `${TeamsTabViewActionId.EditTeam}:${team.id}`,
      );

    const chooseRules = async (form: View, rules: TeamRulesChoice) => {
      const since = t.slackApi.mark();

      await t.slack
        .actOnView(workspace, admin, form, TeamModalActionId.Rules, rules)
        .expect(200);
      await t.idle();

      return t.slackApi.updatedModal(workspace.token, { since });
    };

    const teamItemsOf = async () =>
      listItems(await openAppHomeTab(t, workspace, admin, TEAMS_TAB)).map(
        ({ title, fields }) => [
          title,
          fields.Rules,
          fields['Vacation Policy'],
          fields.Approvers,
        ],
      );

    it('HR saves company rules from Teams and a new team follows them', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Standard' });
      const form = await openCompanyRules(hr);
      const since = t.slackApi.mark();

      const response = await t.slack
        .submitView(workspace, hr, form, {
          policy: policy.id,
          hr_approvers: [hr.slack_id],
          hr_approvers_rule: [ApprovalRule.All],
          approval_notification_recipients: [officeManager.slack_id],
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, hr, since))).toBe(
        '✅ Company rules saved.',
      );
      expect(
        await t.app.get(CompanyRulesService).get(workspace.id),
      ).toMatchObject({
        vacation_policy_id: policy.id,
        hr_approvers: [hr.slack_id],
        hr_approvers_rule: ApprovalRule.All,
        approval_notification_recipients: [officeManager.slack_id],
      });

      const teamForm = await openTeamForm();
      expect(
        findAction(teamForm.blocks, TeamModalActionId.Rules).element,
      ).toMatchObject({ initial_option: { value: TeamRulesChoice.Company } });
      expect(actionIdsOf(teamForm)).not.toContain('policy');
      await t.slack
        .submitView(workspace, admin, teamForm, { name: 'Design' })
        .expect(200);

      expect(await workspace.rows('teams')).toEqual([
        expect.objectContaining({
          name: 'Design',
          rule_set_id: await companyRuleSetId(),
        }),
      ]);
      expect(await teamItemsOf()).toEqual([
        ['Design', 'company', 'Standard', `HR <@${hr.slack_id}> (all)`],
      ]);
    });

    it('switching a team to its own rules shows level 2, recipients and policy filled from the company rules', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Standard' });
      const ownHr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Otto Own HR',
      });
      await setCompanyRules({
        hrApprovers: [hr.slack_id],
        notificationRecipients: [officeManager.slack_id],
        vacationPolicyId: policy.id,
      });
      // The team still holds what it had before it followed the company rules.
      const team = await workspace.addTeam({
        rule_set_id: await companyRuleSetId(),
        hr_approvers: [ownHr.slack_id],
      });
      const form = await openTeamForm(team);
      expect(actionIdsOf(form)).not.toContain('hr_approvers');

      const own = await chooseRules(form, TeamRulesChoice.Own);

      expect((own as { id?: string }).id).toBe((form as { id?: string }).id);
      expect(
        findAction(own.blocks, 'hr_approvers').element.initial_options.map(
          ({ value }: { value: string }) => value,
        ),
      ).toEqual([hr.slack_id]);
      expect(
        findAction(own.blocks, 'approval_notification_recipients').element
          .initial_users,
      ).toEqual([officeManager.slack_id]);
      expect(
        findAction(own.blocks, 'policy').element.initial_option.value,
      ).toBe(policy.id);
      expect(findAction(own.blocks, 'hr_approvers').blockId).toMatch(
        /^hr_approvers_block:own\./,
      );

      await t.slack.submitView(workspace, admin, own).expect(200);

      expect(await workspace.row('teams', team.id)).toMatchObject({
        rule_set_id: null,
        hr_approvers: [hr.slack_id],
        approval_notification_recipients: [officeManager.slack_id],
        vacation_policy_id: policy.id,
      });
    });

    it('a team switched back to company rules drops its own values from the tab', async () => {
      const companyPolicy = await workspace.addVacationPolicy({
        name: 'Company',
      });
      const ownPolicy = await workspace.addVacationPolicy({ name: 'Own' });
      const ownHr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Otto Own HR',
      });
      await setCompanyRules({
        hrApprovers: [hr.slack_id],
        vacationPolicyId: companyPolicy.id,
      });
      const team = await workspace.addTeam({
        name: 'Design',
        vacation_policy_id: ownPolicy.id,
        hr_approvers: [ownHr.slack_id],
      });
      expect(await teamItemsOf()).toEqual([
        ['Design', 'own', 'Own', `HR <@${ownHr.slack_id}> (any one)`],
      ]);
      const form = await openTeamForm(team);
      expect(
        findAction(form.blocks, TeamModalActionId.Rules).element,
      ).toMatchObject({ initial_option: { value: TeamRulesChoice.Own } });

      const company = await chooseRules(form, TeamRulesChoice.Company);
      expect(actionIdsOf(company)).not.toContain('policy');
      await t.slack.submitView(workspace, admin, company).expect(200);

      expect(await teamItemsOf()).toEqual([
        ['Design', 'company', 'Company', `HR <@${hr.slack_id}> (any one)`],
      ]);
      expect(await workspace.row('teams', team.id)).toMatchObject({
        rule_set_id: await companyRuleSetId(),
        vacation_policy_id: ownPolicy.id,
        hr_approvers: [ownHr.slack_id],
      });
    });

    it('refuses level 2 approvers without the HR or Admin role and a policy of another workspace', async () => {
      const form = await openCompanyRules(admin);
      const other = await t.createWorkspace();
      const foreignPolicy = await other.addVacationPolicy();

      // Slack takes values from the client: a form can name anyone.
      const approvers = await t.slack
        .submitView(
          workspace,
          admin,
          form,
          {},
          {
            hr_approvers_block: {
              hr_approvers: {
                type: 'multi_static_select',
                selected_options: [
                  {
                    value: officeManager.slack_id,
                    text: { type: 'plain_text', text: 'Olga Office' },
                  },
                ],
              },
            },
          },
        )
        .expect(200);
      const policy = await t.slack
        .submitView(
          workspace,
          admin,
          form,
          {},
          {
            policy_block: {
              policy: {
                type: 'static_select',
                selected_option: {
                  value: foreignPolicy.id,
                  text: { type: 'plain_text', text: 'Foreign' },
                },
              },
            },
          },
        )
        .expect(200);

      expect(approvers.body).toEqual({
        response_action: 'errors',
        errors: {
          hr_approvers_block: 'Level 2 approvers need the HR or Admin role.',
        },
      });
      expect(policy.body).toEqual({
        response_action: 'errors',
        errors: {
          policy_block: 'This vacation policy is not in this workspace.',
        },
      });
      expect(
        (await t.app.get(CompanyRulesService).get(workspace.id)).hr_approvers,
      ).toEqual([]);
    });

    it('a member cannot open or submit the company rules form', async () => {
      const form = await openCompanyRules(admin);
      const teamsTab = await openAppHomeTab(t, workspace, admin, TEAMS_TAB);
      const since = t.slackApi.mark();

      await t.slack
        .actOnView(
          workspace,
          officeManager,
          teamsTab,
          TeamsTabViewActionId.CompanyRules,
        )
        .expect(200);
      await t.idle();
      await t.slack
        .submitView(workspace, officeManager, form, {
          hr_approvers: [hr.slack_id],
        })
        .expect(200);

      expect(() => t.slackApi.openedModal(workspace.token, { since })).toThrow(
        'No modal was opened',
      );
      expect(
        (await t.app.get(CompanyRulesService).get(workspace.id)).hr_approvers,
      ).toEqual([]);
    });
  });
});
