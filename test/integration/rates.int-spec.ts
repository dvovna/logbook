import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { PersonRateModalActionId } from '@modules/slack/tabs/projects/enums/person-rate-modal-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import {
  actionIdsOf,
  listItems,
  modalError,
  noticeOf,
  sectionTexts,
} from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Settings → Projects.
const PROJECTS_TAB = [NavigationActionId.Settings, NavigationActionId.Projects];

const { Person, HourlyRate } = PersonRateModalActionId;

// Hourly rates on projects, people's own rates, and the workspace's currency:
// Admin and HR see and set rates, an admin sets the currency, and managers,
// who see the projects, see neither.
describe('Rates', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let hr: Tables<'users'>;
  let manager: Tables<'users'>;
  let ada: Tables<'users'>;

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
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Max Manager',
    });
    ada = await workspace.addUser({ name: 'Ada Lovelace' });
  });

  const openProjectsTab = (user = admin) =>
    openAppHomeTab(t, workspace, user, PROJECTS_TAB);

  const openFromMenu = async (
    item: ProjectsTabViewActionId,
    project: Tables<'projects'>,
    user = admin,
  ) =>
    openModalFrom(
      t,
      workspace,
      user,
      await openProjectsTab(user),
      ProjectsTabViewActionId.ManageProjectMenu,
      `${item}:${project.id}`,
    );

  // Submits `modal` as `user`; returns the response and the Projects tab the
  // app published after it.
  const submit = async (
    user: Tables<'users'>,
    modal: View,
    values: Record<string, string | undefined>,
  ) => {
    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, user, modal, values)
      .expect(200);

    return { response, tab: await publishedHome(t, workspace, user, since) };
  };

  // Sends an action from `view` that `view` may not offer, as a member could.
  const forge = async (
    user: Tables<'users'>,
    view: View,
    action: Record<string, unknown>,
  ) => {
    await t.slack.interaction({
      type: 'block_actions',
      team: { id: workspace.slackId },
      user: { id: user.slack_id, team_id: workspace.slackId },
      trigger_id: 'trigger-forged',
      container: { type: 'view' },
      view: { team_id: workspace.slackId, ...view },
      actions: [{ block_id: 'forged', action_ts: '1', ...action }],
    });
    await t.idle();
  };

  const forgeMenu = (
    user: Tables<'users'>,
    view: View,
    item: ProjectsTabViewActionId,
    project: Tables<'projects'>,
  ) =>
    forge(user, view, {
      type: 'overflow',
      action_id: ProjectsTabViewActionId.ManageProjectMenu,
      selected_option: {
        text: { type: 'plain_text', text: item },
        value: `${item}:${project.id}`,
      },
    });

  const openedModals = (since: number) =>
    t.slackApi.callsWith(workspace.token, 'views.open', { since });

  describe("a project's rate", () => {
    it('is set in the project form and shown to Admin and HR', async () => {
      const create = await openModalFrom(
        t,
        workspace,
        admin,
        await openProjectsTab(),
        ProjectsTabViewActionId.AddProject,
      );
      expect(findAction(create.blocks, 'hourlyRate').element).toMatchObject({
        type: 'number_input',
        is_decimal_allowed: true,
      });

      const { response, tab } = await submit(admin, create, {
        name: 'Website',
        hourlyRate: '120.5',
      });

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(tab)).toBe('✅ Project Website created.');
      const [project] = await workspace.rows('projects');
      expect(project).toMatchObject({ name: 'Website', hourly_rate: 120.5 });
      expect(listItems(tab)[0].fields.Rate).toBe('$120.50/h');
      expect(listItems(await openProjectsTab(hr))[0].fields.Rate).toBe(
        '$120.50/h',
      );

      const edit = await openFromMenu(
        ProjectsTabViewActionId.EditProject,
        project,
      );
      expect(findAction(edit.blocks, 'hourlyRate').element.initial_value).toBe(
        '120.50',
      );

      await submit(admin, edit, { hourlyRate: undefined });

      expect(
        (await workspace.row('projects', project.id)).hourly_rate,
      ).toBeNull();
    });

    it.each([
      ['-5', 'Enter the rate as a number, such as 120 or 95.50'],
      ['12.345', 'Enter the rate as a number, such as 120 or 95.50'],
      ['1000001', 'The rate must be at most 1000000'],
    ])('refuses %s', async (rate, error) => {
      const project = await workspace.addProject({ name: 'Website' });
      const edit = await openFromMenu(
        ProjectsTabViewActionId.EditProject,
        project,
      );

      const response = await t.slack
        .submitView(workspace, admin, edit, { hourlyRate: rate })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { hourly_rate_block: error },
      });
      expect(
        (await workspace.row('projects', project.id)).hourly_rate,
      ).toBeNull();
    });
  });

  describe("a person's own rate", () => {
    it('is set and removed in Person Rates, by HR too', async () => {
      const project = await workspace.addProject({
        name: 'Website',
        hourly_rate: 100,
      });

      const modal = await openFromMenu(
        ProjectsTabViewActionId.ManagePersonRates,
        project,
        hr,
      );
      expect(sectionTexts(modal)).toEqual([
        "*Website*: *$100.00/h*.\nA person's own rate replaces the project's for their time on it.",
        '_Nobody has a rate of their own on this project yet._',
      ]);
      const suggestions = await t.slack
        .suggest(workspace, hr, modal, Person, 'ada')
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Ada Lovelace' }, value: ada.id },
      ]);

      const set = await submit(hr, modal, {
        [Person]: ada.id,
        [HourlyRate]: '150',
      });

      expect(set.response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(set.tab)).toBe(
        "✅ Ada Lovelace's rate on Website: $150.00/h.",
      );
      expect(await workspace.rows('project_user_rates')).toEqual([
        expect.objectContaining({
          project_id: project.id,
          user_id: ada.id,
          hourly_rate: 150,
          created_by: hr.id,
          updated_by: hr.id,
        }),
      ]);
      expect(listItems(set.tab)[0].fields).toMatchObject({
        Rate: '$100.00/h',
        'Own rates': 'Ada Lovelace $150.00/h',
      });

      const again = await openFromMenu(
        ProjectsTabViewActionId.ManagePersonRates,
        project,
      );
      expect(sectionTexts(again)[1]).toBe(
        '*Own rates*\n• Ada Lovelace — $150.00/h',
      );
      await submit(admin, again, { [Person]: ada.id, [HourlyRate]: '175.25' });
      expect(await workspace.rows('project_user_rates')).toEqual([
        expect.objectContaining({
          hourly_rate: 175.25,
          created_by: hr.id,
          updated_by: admin.id,
        }),
      ]);

      const removed = await submit(
        admin,
        await openFromMenu(ProjectsTabViewActionId.ManagePersonRates, project),
        { [Person]: ada.id },
      );

      expect(noticeOf(removed.tab)).toBe(
        '✅ Ada Lovelace has no rate of their own on Website now.',
      );
      expect(await workspace.rows('project_user_rates')).toEqual([]);
    });

    it('is not set for someone of another workspace', async () => {
      const project = await workspace.addProject({ name: 'Website' });
      const elsewhere = await (await t.createWorkspace()).addUser();
      const modal = await openFromMenu(
        ProjectsTabViewActionId.ManagePersonRates,
        project,
      );

      const response = await t.slack
        .submitView(workspace, admin, modal, {
          [Person]: elsewhere.id,
          [HourlyRate]: '90',
        })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { person_block: 'This person is not in this workspace.' },
      });
      expect(await workspace.rows('project_user_rates')).toEqual([]);
    });
  });

  describe('the currency', () => {
    it('is changed by an admin, and rates show in it', async () => {
      await workspace.addProject({ name: 'Website', hourly_rate: 90 });
      const projectsTab = await openProjectsTab();
      expect(sectionTexts(projectsTab)).toContain(
        'Rates and amounts are in *USD*.',
      );

      const modal = await openModalFrom(
        t,
        workspace,
        admin,
        projectsTab,
        ProjectsTabViewActionId.ChangeCurrency,
      );
      const { response, tab } = await submit(admin, modal, {
        currency: 'eur',
      });

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(tab)).toBe('✅ Rates and amounts are in EUR now.');
      expect(
        (
          await t.db
            .selectFrom('slack_teams')
            .select('currency')
            .where('id', '=', workspace.id)
            .executeTakeFirstOrThrow()
        ).currency,
      ).toBe('EUR');
      expect(sectionTexts(tab)).toContain('Rates and amounts are in *EUR*.');
      expect(listItems(tab)[0].fields.Rate).toBe('€90.00/h');
    });

    it('must be an ISO 4217 code', async () => {
      const modal = await openModalFrom(
        t,
        workspace,
        admin,
        await openProjectsTab(),
        ProjectsTabViewActionId.ChangeCurrency,
      );

      const response = await t.slack
        .submitView(workspace, admin, modal, { currency: 'ABC' })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: {
          currency_block: 'Enter a currency code such as USD, EUR or GBP.',
        },
      });
    });

    it('is not changed by HR', async () => {
      const hrTab = await openProjectsTab(hr);
      expect(sectionTexts(hrTab)).toContain('Rates and amounts are in *USD*.');
      expect(actionIdsOf(hrTab)).not.toContain(
        ProjectsTabViewActionId.ChangeCurrency,
      );

      const since = t.slackApi.mark();
      await forge(hr, hrTab, {
        type: 'button',
        action_id: ProjectsTabViewActionId.ChangeCurrency,
      });
      expect(openedModals(since)).toEqual([]);

      const adminsForm = await openModalFrom(
        t,
        workspace,
        admin,
        await openProjectsTab(),
        ProjectsTabViewActionId.ChangeCurrency,
      );
      const response = await t.slack
        .submitView(workspace, hr, adminsForm, { currency: 'EUR' })
        .expect(200);

      expect(response.body.view.title.text).toBe('Forbidden');
      expect(
        (
          await t.db
            .selectFrom('slack_teams')
            .select('currency')
            .where('id', '=', workspace.id)
            .executeTakeFirstOrThrow()
        ).currency,
      ).toBe('USD');
    });
  });

  describe('for a manager', () => {
    it('are not shown, and their forms do not open or save', async () => {
      const project = await workspace.addProject({
        name: 'Website',
        hourly_rate: 100,
      });
      await workspace.addPersonRate(project, ada, 150);

      const managersTab = await openProjectsTab(manager);
      expect(listItems(managersTab)[0].fields).not.toHaveProperty('Rate');
      expect(listItems(managersTab)[0].fields).not.toHaveProperty('Own rates');
      expect(JSON.stringify(managersTab.blocks)).not.toMatch(/\$\d/);
      expect(sectionTexts(managersTab)).not.toContain(
        'Rates and amounts are in *USD*.',
      );
      expect(listItems(managersTab)[0].menu).toEqual([
        ProjectsTabViewActionId.ManageProjectAssignments,
        ProjectsTabViewActionId.ArchiveProject,
      ]);

      const since = t.slackApi.mark();
      for (const item of [
        ProjectsTabViewActionId.EditProject,
        ProjectsTabViewActionId.ManagePersonRates,
      ]) {
        await forgeMenu(manager, managersTab, item, project);
      }
      await forge(manager, managersTab, {
        type: 'button',
        action_id: ProjectsTabViewActionId.ChangeCurrency,
      });
      expect(openedModals(since)).toEqual([]);

      // The admin's forms, submitted by the manager.
      const personRates = await openFromMenu(
        ProjectsTabViewActionId.ManagePersonRates,
        project,
      );
      const rateResponse = await t.slack
        .submitView(workspace, manager, personRates, {
          [Person]: ada.id,
          [HourlyRate]: '1',
        })
        .expect(200);
      const edit = await openFromMenu(
        ProjectsTabViewActionId.EditProject,
        project,
      );
      const editResponse = await t.slack
        .submitView(workspace, manager, edit, { hourlyRate: '1' })
        .expect(200);

      expect(rateResponse.body.view.title.text).toBe('Forbidden');
      expect(editResponse.body.view.title.text).toBe('Forbidden');
      expect(await workspace.rows('project_user_rates')).toEqual([
        expect.objectContaining({ hourly_rate: 150 }),
      ]);
      expect((await workspace.row('projects', project.id)).hourly_rate).toBe(
        100,
      );
    });

    it('keeps the rates when assigning people to the project', async () => {
      const project = await workspace.addProject({ hourly_rate: 100 });
      await workspace.assignToProject(project, { users: [ada] });
      await workspace.addPersonRate(project, ada, 150);

      const assignments = await openFromMenu(
        ProjectsTabViewActionId.ManageProjectAssignments,
        project,
        manager,
      );
      await submit(manager, assignments, { project_users: undefined });

      expect(await workspace.rows('project_users')).toEqual([]);
      expect(await workspace.rows('project_user_rates')).toEqual([
        expect.objectContaining({ user_id: ada.id, hourly_rate: 150 }),
      ]);
    });
  });
});
