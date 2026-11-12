import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  TeamModalActionId,
  TeamsTabViewActionId,
} from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { noticeOf, sectionTexts } from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';
import { SlackJson } from './support/block-kit';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { dmOf } from './support/team-file';
import { SETUP_BLOCK_ID } from '@modules/slack/tabs/home/views/home-tab.view';

const POLICY_STEP = {
  text: "*Create a vacation policy*\nDays per year and public holidays. Without one, balances aren't checked.",
  button: NavigationActionId.Policies,
};
const RULES_STEP = {
  text: '*Set the company rules*\nWho approves after the team lead, who hears of decisions, and the policy teams follow.',
  button: TeamsTabViewActionId.CompanyRules,
};
const TEAM_STEP = {
  text: "*Create teams and pick their approvers*\nA team's approvers decide time off for its people. The team file sets up everyone at once.",
  buttons: [TeamsTabViewActionId.TeamFile, NavigationActionId.Teams],
};
const peopleStep = (count: number, goTo = 'go to HR or the admins') => ({
  text: `*Put people in teams*
${count} ${count === 1 ? 'person has' : 'people have'} no team: their requests ${goTo}.`,
  button: NavigationActionId.People,
});
const PROJECTS_STEP = {
  text: '*Add projects* · _optional_\nOnly if you track time: people log hours on them.',
  button: NavigationActionId.Projects,
};

// What an admin sees until the workspace is set up, and the team form's
// members.
describe('First setup', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
  });

  // The checklist's lines: their text, and the screen a step's button opens.
  const checklistOf = async (user: Tables<'users'>) =>
    ((await openAppHomeTab(t, workspace, user)).blocks as SlackJson[])
      .filter(({ block_id }) => block_id?.startsWith(SETUP_BLOCK_ID))
      .map(({ type, text, elements, accessory }) =>
        type === 'actions'
          ? { buttons: elements.map(({ action_id }: SlackJson) => action_id) }
          : {
              text: text?.text ?? elements[0].text,
              ...(accessory && { button: accessory.action_id }),
            },
      );

  describe('the checklist on Home', () => {
    it('shows an admin each step left, with the screen that does it', async () => {
      await workspace.addUser({ name: 'Mo Member' });

      expect(await checklistOf(admin)).toEqual([
        { text: '*🚀 Set up Logbook* · 0 of 4 done' },
        POLICY_STEP,
        RULES_STEP,
        { text: TEAM_STEP.text },
        { buttons: TEAM_STEP.buttons },
        peopleStep(2),
        PROJECTS_STEP,
      ]);
    });

    it('goes once policy, rules, a team with approvers and everyone in a team are done', async () => {
      const policy = await workspace.addVacationPolicy();
      const team = await workspace.addTeam({
        vacation_policy_id: policy.id,
        manager_approvers: [admin.slack_id],
      });
      await workspace.addProject();
      const member = await workspace.addUser({ name: 'Mo Member' });

      expect(await checklistOf(admin)).toEqual([
        { text: '*🚀 Set up Logbook* · 3 of 4 done' },
        {
          text: '✅ Done: vacation policy, company rules, team with approvers, projects',
        },
        peopleStep(2),
      ]);

      await t.db
        .updateTable('users')
        .set({ team_id: team.id })
        .where('id', 'in', [admin.id, member.id])
        .execute();

      expect(await checklistOf(admin)).toEqual([]);
    });

    describe('company rules', () => {
      const setCompanyApprovers = async (hrApprovers: string[]) =>
        t.app.get(CompanyRulesService).update(
          workspace.id,
          {
            hrApprovers,
            hrApproversRule: ApprovalRule.Any,
            notificationRecipients: [],
            vacationPolicyId: null,
          },
          admin as unknown as IUserViewModel,
        );

      const followingCompanyRules = async () =>
        workspace.addTeam({
          rule_set_id: (await t.app.get(CompanyRulesService).get(workspace.id))
            .id,
          manager_approvers: [admin.slack_id],
        });

      it('shows company rules until they name a second approver', async () => {
        await workspace.addVacationPolicy();
        await followingCompanyRules();

        expect(await checklistOf(admin)).toEqual([
          { text: '*🚀 Set up Logbook* · 2 of 4 done' },
          { text: '✅ Done: vacation policy, team with approvers' },
          RULES_STEP,
          peopleStep(1),
          PROJECTS_STEP,
        ]);

        const hr = await workspace.addUser({ role: UserRole.HR });
        await setCompanyApprovers([hr.slack_id]);

        expect(
          (await checklistOf(admin)).map(({ text }) => text),
        ).not.toContain(RULES_STEP.text);
      });

      it('says where the requests of people in no team go: the company rules approvers, else HR or the admins', async () => {
        await workspace.addVacationPolicy();
        await followingCompanyRules();
        const peopleTexts = async () =>
          (await checklistOf(admin))
            .map(({ text }) => text)
            .filter((text) => text?.startsWith('*Put people in teams*'));

        expect(await peopleTexts()).toEqual([peopleStep(1).text]);

        const hr = await workspace.addUser({ role: UserRole.HR });
        await setCompanyApprovers([hr.slack_id]);

        expect(await peopleTexts()).toEqual([
          peopleStep(
            2,
            "skip level 1 and go to the company rules' approvers, or to HR or the admins when none of them can approve",
          ).text,
        ]);
      });

      it('counts as done when every team has rules of its own', async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });

        expect(
          (await checklistOf(admin)).map(({ text }) => text),
        ).not.toContain(RULES_STEP.text);
      });

      it('is not done while a second team follows the company rules', async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });
        await followingCompanyRules();

        expect(await checklistOf(admin)).toContainEqual(RULES_STEP);
      });

      it('ignores the old own approvers of a team that follows the company rules', async () => {
        await workspace.addVacationPolicy();
        const team = await followingCompanyRules();
        await t.db
          .updateTable('teams')
          .set({ hr_approvers: [admin.slack_id] })
          .where('id', '=', team.id)
          .execute();

        expect(await checklistOf(admin)).toContainEqual(RULES_STEP);
      });

      it("doesn't take the old own level 2 of a team that follows the company rules for a team with approvers", async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({
          rule_set_id: (await t.app.get(CompanyRulesService).get(workspace.id))
            .id,
          hr_approvers: [admin.slack_id],
        });

        expect(await checklistOf(admin)).toContainEqual({
          text: TEAM_STEP.text,
        });
      });

      it('does not count as done with no teams, whatever the company rules lack', async () => {
        await workspace.addVacationPolicy();

        expect(await checklistOf(admin)).toContainEqual(RULES_STEP);
      });
    });

    it('is only for Admin and HR', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });

      expect(await checklistOf(manager)).toEqual([]);
    });
  });

  describe("the checklist's buttons", () => {
    it('send HR the team file with the file button', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      const home = await openAppHomeTab(t, workspace, hr);
      const since = t.slackApi.mark();

      await t.slack
        .actOnView(workspace, hr, home, TeamsTabViewActionId.TeamFile)
        .expect(200);
      await t.idle();

      expect(
        t.slackApi
          .uploadedFiles(workspace.token, dmOf(hr), { since })
          .map(({ filename }) => filename),
      ).toEqual(['team-setup.csv']);
    });

    it('open the company rules from Home and save them back to Home', async () => {
      const hr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Hana HR',
      });
      await workspace.addVacationPolicy();
      await workspace.addTeam({
        rule_set_id: (await t.app.get(CompanyRulesService).get(workspace.id))
          .id,
        manager_approvers: [admin.slack_id],
      });
      const home = await openAppHomeTab(t, workspace, admin);
      const modal = await openModalFrom(
        t,
        workspace,
        admin,
        home,
        TeamsTabViewActionId.CompanyRules,
      );
      expect(modal.callback_id).toBe(ViewCallbackId.CompanyRulesSubmit);
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, admin, modal, { hr_approvers: [hr.slack_id] })
        .expect(200);
      const published = await publishedHome(t, workspace, admin, since);

      expect(published.callback_id).toBe(ViewCallbackId.HomeTabView);
      expect(noticeOf(published)).toBe('✅ Company rules saved.');
      expect(
        (published.blocks as SlackJson[]).map(({ text }) => text?.text),
      ).not.toContain(RULES_STEP.text);
    });

    it.each([TeamsTabViewActionId.TeamFile, TeamsTabViewActionId.CompanyRules])(
      'do nothing for a member who sends %s',
      async (actionId) => {
        const member = await workspace.addUser({ name: 'Mo Member' });
        const home = await openAppHomeTab(t, workspace, member);
        const since = t.slackApi.mark();

        await t.slack
          .interaction({
            type: 'block_actions',
            team: { id: workspace.slackId },
            user: { id: member.slack_id, team_id: workspace.slackId },
            trigger_id: 'trigger-forged',
            container: { type: 'view' },
            view: { team_id: workspace.slackId, ...home },
            actions: [
              {
                type: 'button',
                action_id: actionId,
                block_id: ViewCallbackId.HomeTabView,
                value: actionId,
                action_ts: '1',
              },
            ],
          })
          .expect(200);
        await t.idle();

        expect(
          t.slackApi.uploadedFiles(workspace.token, dmOf(member), { since }),
        ).toEqual([]);
        expect(
          t.slackApi.callsWith(workspace.token, 'views.open', { since }),
        ).toEqual([]);
      },
    );
  });

  it('offers to create the first team in the empty list', async () => {
    const teamsTab = await openAppHomeTab(t, workspace, admin, [
      NavigationActionId.Teams,
    ]);
    expect(sectionTexts(teamsTab)).toContain(
      "_No teams yet._ A team's approvers decide its people's time off, under its vacation policy.",
    );

    const form = await openModalFrom(
      t,
      workspace,
      admin,
      teamsTab,
      TeamsTabViewActionId.AddTeam,
    );
    expect(form.callback_id).toBe(ViewCallbackId.TeamFormSubmit);
  });

  describe("the team form's members", () => {
    const openTeamForm = async (teamId?: string) => {
      const teamsTab = await openAppHomeTab(t, workspace, admin, [
        NavigationActionId.Teams,
      ]);

      return teamId
        ? openModalFrom(
            t,
            workspace,
            admin,
            teamsTab,
            TeamsTabViewActionId.ManageTeamMenu,
            `${TeamsTabViewActionId.EditTeam}:${teamId}`,
          )
        : openModalFrom(
            t,
            workspace,
            admin,
            teamsTab,
            TeamsTabViewActionId.AddTeam,
          );
    };

    const teamOf = async (user: Tables<'users'>) =>
      (await workspace.row('users', user.id)).team_id;

    it('puts the chosen people in a new team, moving them from another one', async () => {
      const other = await workspace.addTeam({ name: 'Ops' });
      const ada = await workspace.addUser({ name: 'Ada Lovelace' });
      const bob = await workspace.addUser({
        name: 'Bob Moved',
        team_id: other.id,
      });

      const suggestions = await t.slack
        .suggest(
          workspace,
          admin,
          await openTeamForm(),
          TeamModalActionId.Members,
          'ada',
        )
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Ada Lovelace' }, value: ada.id },
      ]);

      await t.slack
        .submitView(workspace, admin, await openTeamForm(), {
          name: 'Design',
          [TeamModalActionId.Members]: [ada.id, bob.id],
        })
        .expect(200);

      const [design] = (await workspace.rows('teams')).filter(
        ({ name }) => name === 'Design',
      );
      expect(await teamOf(ada)).toBe(design.id);
      expect(await teamOf(bob)).toBe(design.id);
    });

    it('takes out the members no longer chosen, and nobody of another workspace', async () => {
      const team = await workspace.addTeam({ name: 'Design' });
      const ada = await workspace.addUser({
        name: 'Ada Lovelace',
        team_id: team.id,
      });
      const bob = await workspace.addUser({
        name: 'Bob Builder',
        team_id: team.id,
      });
      const elsewhere = await t.createWorkspace();
      const stranger = await elsewhere.addUser();

      await t.slack
        .submitView(workspace, admin, await openTeamForm(team.id), {
          [TeamModalActionId.Members]: [ada.id, stranger.id],
        })
        .expect(200);

      expect(await teamOf(ada)).toBe(team.id);
      expect(await teamOf(bob)).toBeNull();
      expect((await elsewhere.row('users', stranger.id)).team_id).toBeNull();
    });

    it('keeps the inactive members, which the form does not list', async () => {
      const team = await workspace.addTeam({ name: 'Design' });
      const ada = await workspace.addUser({
        name: 'Ada Lovelace',
        team_id: team.id,
      });
      const gone = await workspace.addUser({
        name: 'Gone Away',
        team_id: team.id,
        is_active: false,
      });

      await t.slack
        .submitView(workspace, admin, await openTeamForm(team.id), {
          [TeamModalActionId.Members]: [],
        })
        .expect(200);

      expect(await teamOf(ada)).toBeNull();
      expect(await teamOf(gone)).toBe(team.id);
    });
  });
});
