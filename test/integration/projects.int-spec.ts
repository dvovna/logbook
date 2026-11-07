import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { YesNoValue } from '@modules/slack/common/enums/yes-no-value.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { NO_CLIENT_VALUE } from '@modules/slack/tabs/projects/views/project-modal.view';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import {
  actionIdsOf,
  listItems,
  modalError,
  sectionTexts,
  titlesOf,
  totalCount,
  listCount,
} from './support/tab-readers';
import { acknowledged } from './support/slack-test-client';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Home → Time & Billing → Projects.
const PROJECTS_TAB = [
  AdminNavigationActionId.ManageTimeAndBilling,
  AdminNavigationActionId.ManageProjects,
];

const { ProjectTeams, ProjectUsers } = ProjectAssignmentModalViewActionId;

// The values of the options of a select in a modal.
const optionValues = (modal: View, actionId: string, key = 'options') =>
  (findAction(modal.blocks, actionId).element[key] ?? []).map(
    (option: { value: string }) => option.value,
  );

describe('Projects', () => {
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

  const openProjectsTab = () =>
    openAppHomeTab(t, workspace, admin, PROJECTS_TAB);

  // A modal behind the project's menu item `item`.
  const openFromMenu = async (
    item: ProjectsTabViewActionId,
    project: Tables<'projects'>,
    projectsTab?: View,
  ) =>
    openModalFrom(
      t,
      workspace,
      admin,
      projectsTab ?? (await openProjectsTab()),
      ProjectsTabViewActionId.ManageProjectMenu,
      `${item}:${project.id}`,
    );

  describe('creating a project', () => {
    const openCreateModal = async () =>
      openModalFrom(
        t,
        workspace,
        admin,
        await openProjectsTab(),
        ProjectsTabViewActionId.AddProject,
      );

    it('creates a project for a client and lists it', async () => {
      const acme = await workspace.addClient({ name: 'Acme' });
      await workspace.addClient({
        name: 'Gone',
        archived_at: new Date().toISOString(),
      });
      const modal = await openCreateModal();

      expect(optionValues(modal, 'clientId')).toEqual([
        NO_CLIENT_VALUE,
        acme.id,
      ]);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          name: 'Website',
          clientId: acme.id,
          billable: 'false',
          status: ProjectStatus.OnHold,
          description: 'Landing pages',
        })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ Project 'Website' was created successfully!",
      ]);
      expect(await workspace.rows('projects')).toEqual([
        expect.objectContaining({
          name: 'Website',
          client_id: acme.id,
          billable: false,
          status: ProjectStatus.OnHold,
          description: 'Landing pages',
          created_by: admin.id,
          archived_at: null,
          archived_by: null,
        }),
      ]);

      const [website] = listItems(
        await publishedHome(t, workspace, admin, since),
      );
      expect(website).toMatchObject({
        title: 'Website',
        fields: { Client: 'Acme', Status: 'On-hold', Billable: 'No' },
      });
    });

    it('creates an active billable project without a client by default', async () => {
      const modal = await openCreateModal();

      await t.slack
        .submitView(workspace, admin, modal, { name: 'Internal' })
        .expect(200);

      expect(await workspace.rows('projects')).toEqual([
        expect.objectContaining({
          name: 'Internal',
          client_id: null,
          billable: true,
          status: ProjectStatus.Active,
        }),
      ]);
    });

    it('refuses a second active project with the same name', async () => {
      await workspace.addProject({ name: 'Website' });
      const modal = await openCreateModal();

      const response = await t.slack
        .submitView(workspace, admin, modal, { name: 'Website' })
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'Project with same name already exists.',
      );
      expect(await workspace.rows('projects')).toHaveLength(1);
    });
  });

  describe('editing a project', () => {
    it('renames a project and moves it to another client', async () => {
      const acme = await workspace.addClient({ name: 'Acme' });
      const globex = await workspace.addClient({ name: 'Globex' });
      const project = await workspace.addProject({
        name: 'Website',
        client_id: acme.id,
      });

      const modal = await openFromMenu(
        ProjectsTabViewActionId.EditProject,
        project,
      );
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          name: 'Web shop',
          clientId: globex.id,
          status: ProjectStatus.Completed,
        })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ Project 'Web shop' was updated successfully!",
      ]);
      expect(await workspace.row('projects', project.id)).toMatchObject({
        name: 'Web shop',
        client_id: globex.id,
        status: ProjectStatus.Completed,
        updated_by: admin.id,
      });
    });

    it('unlinks the client when "No Client" is chosen', async () => {
      const acme = await workspace.addClient({ name: 'Acme' });
      const project = await workspace.addProject({ client_id: acme.id });

      const modal = await openFromMenu(
        ProjectsTabViewActionId.EditProject,
        project,
      );
      await t.slack
        .submitView(workspace, admin, modal, { clientId: NO_CLIENT_VALUE })
        .expect(200);

      expect(
        (await workspace.row('projects', project.id)).client_id,
      ).toBeNull();
    });
  });

  describe('assignments', () => {
    it('assigns teams and users found by name', async () => {
      const design = await workspace.addTeam({ name: 'Design' });
      await workspace.addTeam({ name: 'Ops' });
      const ada = await workspace.addUser({ name: 'Ada Lovelace' });
      await workspace.addUser({ name: 'Bob Builder' });
      const project = await workspace.addProject({ name: 'Website' });

      const modal = await openFromMenu(
        ProjectsTabViewActionId.ManageProjectAssignments,
        project,
      );

      const suggestions = await t.slack
        .suggest(workspace, admin, modal, ProjectUsers, 'ada')
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Ada Lovelace' }, value: ada.id },
      ]);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          [ProjectTeams]: [design.id],
          [ProjectUsers]: [ada.id],
        })
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        '✅ Project assignments was updated successfully!',
      ]);
      expect(await workspace.rows('project_teams')).toEqual([
        expect.objectContaining({ project_id: project.id, team_id: design.id }),
      ]);
      expect(await workspace.rows('project_users')).toEqual([
        expect.objectContaining({ project_id: project.id, user_id: ada.id }),
      ]);
      const [listed] = listItems(
        await publishedHome(t, workspace, admin, since),
      );
      expect(listed.fields).toMatchObject({ Teams: '1', Users: '1' });
    });

    it('shows the current assignments and replaces them on submit', async () => {
      const design = await workspace.addTeam({ name: 'Design' });
      const ada = await workspace.addUser({ name: 'Ada Lovelace' });
      const bob = await workspace.addUser({ name: 'Bob Builder' });
      const project = await workspace.addProject();
      await workspace.assignToProject(project, {
        teams: [design],
        users: [ada],
      });

      const modal = await openFromMenu(
        ProjectsTabViewActionId.ManageProjectAssignments,
        project,
      );

      expect(optionValues(modal, ProjectTeams, 'initial_options')).toEqual([
        design.id,
      ]);
      expect(optionValues(modal, ProjectUsers, 'initial_options')).toEqual([
        ada.id,
      ]);

      await t.slack
        .submitView(workspace, admin, modal, {
          [ProjectTeams]: [],
          [ProjectUsers]: [bob.id],
        })
        .expect(200);

      expect(await workspace.rows('project_teams')).toEqual([]);
      expect(await workspace.rows('project_users')).toEqual([
        expect.objectContaining({ project_id: project.id, user_id: bob.id }),
      ]);
    });

    it('suggests only active users of the same workspace', async () => {
      const ada = await workspace.addUser({ name: 'Ada Lovelace' });
      await workspace.addUser({ name: 'Ada Inactive', is_active: false });
      const otherWorkspace = await t.createWorkspace();
      await otherWorkspace.addUser({ name: 'Ada Elsewhere' });
      const project = await workspace.addProject();

      const modal = await openFromMenu(
        ProjectsTabViewActionId.ManageProjectAssignments,
        project,
      );
      const suggestions = await t.slack
        .suggest(workspace, admin, modal, ProjectUsers, 'ada')
        .expect(acknowledged);

      expect(
        suggestions.body.options.map(({ value }: { value: string }) => value),
      ).toEqual([ada.id]);
    });
  });

  describe('the projects list', () => {
    it('filters by status and billable, and shows archived projects on request', async () => {
      const acme = await workspace.addClient({ name: 'Acme' });
      await workspace.addProject({ name: 'Alpha', client_id: acme.id });
      await workspace.addProject({
        name: 'Beta',
        status: ProjectStatus.OnHold,
        billable: false,
      });
      await workspace.addProject({
        name: 'Gamma',
        archived_at: new Date().toISOString(),
        archived_by: admin.id,
      });

      const projectsTab = await openProjectsTab();
      expect(
        listItems(projectsTab).map(({ title, fields }) => [
          title,
          fields.Client,
        ]),
      ).toEqual([
        ['Alpha', 'Acme'],
        ['Beta', '-'],
      ]);
      expect(totalCount(projectsTab)).toBe(2);

      const onHold = await actOnTab(
        t,
        workspace,
        admin,
        projectsTab,
        ProjectsTabViewActionId.FilterByStatus,
        ProjectStatus.OnHold,
      );
      expect(titlesOf(onHold)).toEqual(['Beta']);

      const unfiltered = await actOnTab(
        t,
        workspace,
        admin,
        onHold,
        ProjectsTabViewActionId.ResetFilters,
      );
      const billable = await actOnTab(
        t,
        workspace,
        admin,
        unfiltered,
        ProjectsTabViewActionId.FilterByBillable,
        YesNoValue.Yes,
      );
      expect(titlesOf(billable)).toEqual(['Alpha']);

      const withArchived = await actOnTab(
        t,
        workspace,
        admin,
        unfiltered,
        ProjectsTabViewActionId.IncludeArchivedProjects,
        YesNoValue.Yes,
      );
      expect(titlesOf(withArchived)).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(listItems(withArchived)[2].fields.Archived).toBeDefined();
      expect(totalCount(withArchived)).toBe(3);
    });

    it('pages through projects by name, ten per page', async () => {
      const names = Array.from(
        { length: 11 },
        (_, i) => `P${String(i + 1).padStart(2, '0')}`,
      );
      for (const name of [...names].reverse()) {
        await workspace.addProject({ name });
      }

      const firstPage = await openProjectsTab();
      expect(listCount(firstPage)).toBe('1–10 of 11');
      expect(titlesOf(firstPage)).toEqual(names.slice(0, 10));

      const secondPage = await actOnTab(
        t,
        workspace,
        admin,
        firstPage,
        ProjectsTabViewActionId.PaginationNext,
      );
      expect(listCount(secondPage)).toBe('11–11 of 11');
      expect(titlesOf(secondPage)).toEqual(['P11']);
      expect(totalCount(secondPage)).toBe(11);
    });

    it('finds a project by name', async () => {
      const website = await workspace.addProject({ name: 'Website' });
      await workspace.addProject({ name: 'Mobile app' });
      const projectsTab = await openProjectsTab();

      const suggestions = await t.slack
        .suggest(
          workspace,
          admin,
          projectsTab,
          ProjectsTabViewActionId.FindProjectByName,
          'web',
        )
        .expect(acknowledged);
      expect(suggestions.body.options).toEqual([
        { text: { type: 'plain_text', text: 'Website' }, value: website.id },
      ]);

      const found = await actOnTab(
        t,
        workspace,
        admin,
        projectsTab,
        ProjectsTabViewActionId.FindProjectByName,
        website.id,
      );
      expect(titlesOf(found)).toEqual(['Website']);
    });

    it('offers a manager only assigning and archiving', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const project = await workspace.addProject({ name: 'Website' });

      const projectsTab = await openAppHomeTab(
        t,
        workspace,
        manager,
        PROJECTS_TAB,
      );

      expect(actionIdsOf(projectsTab)).not.toContain(
        ProjectsTabViewActionId.AddProject,
      );
      expect(
        findAction(
          projectsTab.blocks,
          ProjectsTabViewActionId.ManageProjectMenu,
        ).element.options.map(({ value }: { value: string }) => value),
      ).toEqual([
        `${ProjectsTabViewActionId.ManageProjectAssignments}:${project.id}`,
        `${ProjectsTabViewActionId.ArchiveProject}:${project.id}`,
      ]);
    });
  });

  describe('archiving a project', () => {
    it('archives a project', async () => {
      const project = await workspace.addProject({ name: 'Website' });

      const confirmation = await openFromMenu(
        ProjectsTabViewActionId.ArchiveProject,
        project,
      );
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ Project 'Website' has been successfully archived.",
      ]);
      expect(await workspace.row('projects', project.id)).toMatchObject({
        archived_at: expect.any(String),
        archived_by: admin.id,
      });
      expect(titlesOf(await publishedHome(t, workspace, admin, since))).toEqual(
        [],
      );
    });

    it('restores an archived project', async () => {
      const project = await workspace.addProject({
        name: 'Website',
        archived_at: new Date().toISOString(),
        archived_by: admin.id,
      });
      const withArchived = await actOnTab(
        t,
        workspace,
        admin,
        await openProjectsTab(),
        ProjectsTabViewActionId.IncludeArchivedProjects,
        YesNoValue.Yes,
      );

      const confirmation = await openFromMenu(
        ProjectsTabViewActionId.ArchiveProject,
        project,
        withArchived,
      );
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(sectionTexts(response.body.view)).toEqual([
        "✅ Project 'Website' has been successfully restored.",
      ]);
      expect(await workspace.row('projects', project.id)).toMatchObject({
        archived_at: null,
        archived_by: null,
      });
    });
  });
});
