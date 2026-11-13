import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
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
import { actionIdsOf, noticeOf, sectionTexts } from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';
import { SlackJson } from './support/block-kit';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { dmOf } from './support/team-file';
import {
  HomeTabActionId,
  SETUP_BLOCK_ID,
} from '@modules/slack/tabs/home/views/home-tab.view';

const POLICY_STEP = {
  title: 'Create a vacation policy',
  why: "Days per year and public holidays. The first one applies to everyone; without one, balances aren't checked.",
  button: NavigationActionId.Policies,
};
const RULES_STEP = {
  title: 'Set the company rules',
  why: "Whether anyone approves after the team's approvers (HR, leadership), and who hears of decisions. Save them even with no second approval.",
  button: TeamsTabViewActionId.CompanyRules,
};
const TELL_STEP = {
  title: 'Tell your team',
  why: 'People find Logbook only if someone tells them. Get a ready message in your DMs and post it in a channel everyone reads.',
  button: HomeTabActionId.TellTeam,
};
const TEAM_STEP = {
  title: 'Create teams and pick their approvers',
  why: "A team's approvers decide time off for its people. The team file sets up everyone at once.",
  button: TeamsTabViewActionId.TeamFile,
  buttons: [TeamsTabViewActionId.TeamFile, NavigationActionId.Teams],
};
const peopleStep = (count: number, goTo = 'go to HR or the admins') => ({
  title: 'Put people in teams',
  why: `${count} ${count === 1 ? 'person has' : 'people have'} no team: their requests ${goTo}.`,
  button: NavigationActionId.People,
});

interface IStep {
  title: string;
  why: string;
  button: string;
  buttons?: string[];
}

// The step to do now, in full; a step with two buttons has them in a row.
const nextText = ({ title, why }: IStep) => `*Next: ${title}*\n${why}`;
const next = (step: IStep) => [
  { text: nextText(step), ...(step.buttons ? {} : { button: step.button }) },
  ...(step.buttons ? [{ buttons: step.buttons }] : []),
];
// A required step after it: a line with its first button.
const then = ({ title, button }: IStep) => ({ text: `Then: ${title}`, button });
const OPTIONAL_STEPS = [
  { text: 'Optional: bring in leave balances · add projects' },
  {
    buttons: [UsersTabViewActionId.ImportLeave, NavigationActionId.Projects],
  },
];

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

  // Whether the checklist still has the step, as the next one or a later one.
  const shows = async ({ title }: { title: string }) =>
    (await checklistOf(admin)).some(({ text }) => text?.includes(title));

  describe('the checklist on Home', () => {
    it('shows an admin each step left, with the screen that does it', async () => {
      await workspace.addUser({ name: 'Mo Member' });

      expect(await checklistOf(admin)).toEqual([
        { text: '*🚀 Set up Logbook* · 0 of 5 done' },
        ...next(POLICY_STEP),
        then(RULES_STEP),
        then(TEAM_STEP),
        then(peopleStep(2)),
        then(TELL_STEP),
        ...OPTIONAL_STEPS,
      ]);
    });

    // A policy nobody follows limits nothing: the step is done once the
    // company rules or a team name one, which the first one does by itself.
    it('counts the policy only once it applies to someone', async () => {
      const policy = await workspace.addVacationPolicy();

      expect(await shows(POLICY_STEP)).toBe(true);

      await t.app
        .get(CompanyRulesService)
        .adoptPolicyIfNone(workspace.id, policy.id);

      expect(await shows(POLICY_STEP)).toBe(false);
    });

    it('sends the message for the team, then counts the team told', async () => {
      await workspace.addProject();
      const home = await openAppHomeTab(t, workspace, admin);
      const since = t.slackApi.mark();

      await t.slack
        .actOnView(workspace, admin, home, HomeTabActionId.TellTeam)
        .expect(200);
      const published = await publishedHome(t, workspace, admin, since);

      expect(
        t.slackApi
          .postedMessages(workspace.token, admin.slack_id, { since })
          .map(({ text }) => text),
      ).toEqual([
        [
          'Copy this into a channel everyone reads, e.g. #general:',
          '',
          'Hi everyone! We now use *Logbook* in Slack for time off and time tracking.',
          '• Find *Logbook* under *Apps* in the Slack sidebar and open its *Home* tab: it shows your balance and your requests.',
          '• To request time off, click *🌴 Request time off* there, or type `/vacations request` in any channel.',
          '• To log your hours, click *➕ Log Time* there, or type `/log`.',
          "• Requests go to your team's approvers, and Logbook messages you when they're decided.",
        ].join('\n'),
      ]);
      expect(noticeOf(published)).toBe(
        '✅ The message for your team is in your DMs from Logbook: copy it into a channel.',
      );
      expect(await shows(TELL_STEP)).toBe(false);
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
        { text: '*🚀 Set up Logbook* · 3 of 5 done' },
        {
          text: '✅ Done: vacation policy, company rules, team with approvers, projects',
        },
        ...next(peopleStep(2)),
        then(TELL_STEP),
        { text: 'Optional: bring in leave balances' },
        { buttons: [UsersTabViewActionId.ImportLeave] },
      ]);

      await t.db
        .updateTable('users')
        .set({ team_id: team.id })
        .where('id', 'in', [admin.id, member.id])
        .execute();

      expect(await shows(TELL_STEP)).toBe(true);

      await t.db
        .updateTable('slack_teams')
        .set({ team_told_at: new Date().toISOString() })
        .where('id', '=', workspace.id)
        .execute();

      expect(await checklistOf(admin)).toEqual([]);
    });

    describe('company rules', () => {
      // Saves the company rules as the form does, keeping their policy.
      const setCompanyApprovers = async (hrApprovers: string[]) =>
        t.app.get(CompanyRulesService).update(
          workspace.id,
          {
            hrApprovers,
            hrApproversRule: ApprovalRule.Any,
            notificationRecipients: [],
            vacationPolicyId: (
              await t.app.get(CompanyRulesService).get(workspace.id)
            ).vacation_policy_id,
          },
          admin as unknown as IUserViewModel,
        );
      // A policy the company rules use, as the first one created is.
      const applyPolicy = async () =>
        t.app
          .get(CompanyRulesService)
          .adoptPolicyIfNone(
            workspace.id,
            (await workspace.addVacationPolicy()).id,
          );

      const followingCompanyRules = async () =>
        workspace.addTeam({
          rule_set_id: (await t.app.get(CompanyRulesService).get(workspace.id))
            .id,
          manager_approvers: [admin.slack_id],
        });

      // A small company may want the team's approval alone: saving the
      // rules is the step, a second approval or none.
      it('shows company rules until someone saves them, with or without a second approver', async () => {
        await applyPolicy();
        await followingCompanyRules();

        expect(await checklistOf(admin)).toEqual([
          { text: '*🚀 Set up Logbook* · 2 of 5 done' },
          { text: '✅ Done: vacation policy, team with approvers' },
          ...next(RULES_STEP),
          then(peopleStep(1)),
          then(TELL_STEP),
          ...OPTIONAL_STEPS,
        ]);

        await setCompanyApprovers([]);

        expect(await shows(RULES_STEP)).toBe(false);
      });

      it('says where the requests of people in no team go: the company rules approvers, else HR or the admins', async () => {
        await applyPolicy();
        // A team with rules of its own: the company rules step is done, so
        // people in teams is the next one and says why.
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });
        const peopleTexts = async () =>
          (await checklistOf(admin))
            .map(({ text }) => text)
            .filter((text) => text?.includes('Put people in teams'));

        expect(await peopleTexts()).toEqual([nextText(peopleStep(1))]);

        const hr = await workspace.addUser({ role: UserRole.HR });
        await setCompanyApprovers([hr.slack_id]);

        expect(await peopleTexts()).toEqual([
          nextText(
            peopleStep(
              2,
              "skip the team's approval and go to the company rules' second approval, or to HR or the admins when nobody there can approve",
            ),
          ),
        ]);
      });

      it('counts as done when every team has rules of its own', async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });

        expect(await shows(RULES_STEP)).toBe(false);
      });

      it('is not done while a second team follows the company rules', async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({ hr_approvers: [admin.slack_id] });
        await followingCompanyRules();

        expect(await shows(RULES_STEP)).toBe(true);
      });

      it('ignores the old own approvers of a team that follows the company rules', async () => {
        await workspace.addVacationPolicy();
        const team = await followingCompanyRules();
        await t.db
          .updateTable('teams')
          .set({ hr_approvers: [admin.slack_id] })
          .where('id', '=', team.id)
          .execute();

        expect(await shows(RULES_STEP)).toBe(true);
      });

      it("doesn't take the old own level 2 of a team that follows the company rules for a team with approvers", async () => {
        await workspace.addVacationPolicy();
        await workspace.addTeam({
          rule_set_id: (await t.app.get(CompanyRulesService).get(workspace.id))
            .id,
          hr_approvers: [admin.slack_id],
        });

        expect(await shows(TEAM_STEP)).toBe(true);
      });

      it('does not count as done with no teams, whatever the company rules lack', async () => {
        await workspace.addVacationPolicy();

        expect(await shows(RULES_STEP)).toBe(true);
      });
    });

    // No projects, no policy, nothing taken: nothing to count yet.
    it('leaves a member of a workspace that is not set up one line and one button', async () => {
      const member = await workspace.addUser({ name: 'Mo Member' });
      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home)).toEqual([
        '*🏝 Time off*\nNo vacation policy applies to you yet: you can request time off, and it is tracked without a balance.',
      ]);
      expect(actionIdsOf(home)).not.toContain(HomeTabActionId.LogTime);
      expect(actionIdsOf(home)).toContain(HomeTabActionId.OpenVacationModal);
    });

    it('shows time tracking once the workspace has a project', async () => {
      const member = await workspace.addUser({ name: 'Mo Member' });
      await workspace.addProject();

      const home = await openAppHomeTab(t, workspace, member);

      expect(sectionTexts(home)).toEqual(
        expect.arrayContaining([
          '*🕒 Time Tracking*',
          'Nothing logged this week yet.',
        ]),
      );
      expect(actionIdsOf(home)).toContain(HomeTabActionId.LogTime);
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
        (published.blocks as SlackJson[]).some(({ text }) =>
          text?.text?.includes(RULES_STEP.title),
        ),
      ).toBe(false);
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
