import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { listItems, sectionTexts, buttonText } from './support/tab-readers';

const sorted = (values: (string | undefined)[]) => [...values].sort();

// Two workspaces with the same data: same names, same emails. Everything an
// admin of the first one sees must come from the first one only.
describe('Workspace isolation', () => {
  let t: ITestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  // A team with an admin and a member, a client, a project and their time:
  // `minutes` per entry tells the workspaces apart in sums.
  const seed = async (minutes: number) => {
    const workspace = await t.createWorkspace();
    const admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
      email: 'ann@example.test',
    });
    const design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [admin.slack_id],
    });
    const ada = await workspace.addUser({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      team_id: design.id,
    });
    const acme = await workspace.addClient({ name: 'Acme' });
    const website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
    await workspace.assignToProject(website, { teams: [design], users: [ada] });
    const submitted = await workspace.addTimeEntry(ada, website, {
      minutes,
      status: TimeEntryStatus.Submitted,
    });
    const approved = await workspace.addTimeEntry(ada, website, {
      minutes,
      status: TimeEntryStatus.Approved,
      work_date: '2026-06-15',
    });
    const vacation = await workspace.addVacationRequest(ada, {
      start_date: '2026-07-06',
      end_date: '2026-07-06',
      status: 'pending',
    });

    return {
      workspace,
      admin,
      design,
      ada,
      acme,
      website,
      entries: [submitted, approved],
      vacation,
    };
  };

  let a: Awaited<ReturnType<typeof seed>>;
  let b: Awaited<ReturnType<typeof seed>>;

  beforeEach(async () => {
    a = await seed(60);
    b = await seed(120);
  });

  const open = (path: string[], user: Tables<'users'> = a.admin) =>
    openAppHomeTab(t, a.workspace, user, path);

  const idsOf = (view: View) => sorted(listItems(view).map(({ id }) => id));

  const suggestions = async (view: View, actionId: string, query: string) =>
    (
      await t.slack
        .suggest(a.workspace, a.admin, view, actionId, query)
        .expect(acknowledged)
    ).body.options.map(({ value }: { value: string }) => value);

  describe('lists', () => {
    it('shows only its own users and teams', async () => {
      const users = await open([NavigationActionId.People]);
      const teams = await open([
        NavigationActionId.Settings,
        NavigationActionId.Teams,
      ]);

      expect(idsOf(users)).toEqual(sorted([a.admin.id, a.ada.id]));
      expect(idsOf(teams)).toEqual([a.design.id]);
      expect(listItems(teams)[0].fields.Members).toBe('1 (Ada Lovelace)');
    });

    it('shows only its own clients, projects and time entries', async () => {
      const clients = await open([
        NavigationActionId.Settings,
        NavigationActionId.Clients,
      ]);
      const projects = await open([
        NavigationActionId.Settings,
        NavigationActionId.Projects,
      ]);
      const timeLogs = await open([
        NavigationActionId.Reports,
        NavigationActionId.TimeLogs,
      ]);

      expect(idsOf(clients)).toEqual([a.acme.id]);
      expect(idsOf(projects)).toEqual([a.website.id]);
      expect(listItems(projects)[0].fields).toMatchObject({
        Teams: a.design.name,
        People: 'Ada Lovelace',
      });
      expect(idsOf(timeLogs)).toEqual(sorted(a.entries.map(({ id }) => id)));
    });

    it('shows only its own entries and requests waiting for approval', async () => {
      const approvals = await open([NavigationActionId.Approvals]);
      const vacationRequests = await open([
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]);

      expect(idsOf(approvals)).toEqual([a.entries[0].id]);
      expect(idsOf(vacationRequests)).toEqual([a.vacation.id]);
    });
  });

  describe('sums', () => {
    it('counts only its own time on Home and in Reports', async () => {
      const home = sectionTexts(await open([], a.ada));
      const reports = await open([NavigationActionId.Reports]);

      expect(home).toContain('Today: *1h* (Acme 1h)');
      expect(home).toContain('This week: *2h* total');
      expect(sectionTexts(reports)).toContain(
        '*This week*\n*2h* logged · *2h* billable · *1* active projects',
      );
      expect(buttonText(reports, NavigationActionId.Approvals)).toBe(
        '✅ Approvals (1)',
      );
    });

    it("counts for a manager only their teams' time", async () => {
      const designLead = await a.workspace.addUser({
        role: UserRole.Manager,
        name: 'Dana Design',
      });
      const otherLead = await a.workspace.addUser({
        role: UserRole.Manager,
        name: 'Olga Other',
      });
      await t.db
        .updateTable('teams')
        .set({ manager_approvers: [designLead.slack_id] })
        .where('id', '=', a.design.id)
        .execute();
      await a.workspace.addTeam({ manager_approvers: [otherLead.slack_id] });

      const weekOf = async (manager: Tables<'users'>) =>
        sectionTexts(await open([NavigationActionId.Reports], manager)).find(
          (text) => text.startsWith('*This week*'),
        );

      expect(await weekOf(designLead)).toContain('*2h* logged');
      expect(await weekOf(otherLead)).toContain('*0h* logged');
    });

    it('bills only its own approved time', async () => {
      const form = await openModalFrom(
        t,
        a.workspace,
        a.admin,
        await open([NavigationActionId.Reports]),
        ReportsTabActionId.BillingReport,
      );
      expect(
        findAction(form.blocks, 'clientId').element.options.map(
          ({ value }: { value: string }) => value,
        ),
      ).toEqual([a.acme.id]);

      const since = t.slackApi.mark();
      await t.slack
        .submitView(a.workspace, a.admin, form, {
          clientId: a.acme.id,
          fromDate: '2026-06-01',
          toDate: '2026-06-30',
        })
        .expect(200);

      const reports = await publishedHome(t, a.workspace, a.admin, since);
      expect(
        sectionTexts(reports).find((text) =>
          text.startsWith('*Billing report'),
        ),
      ).toContain('Approved: *1h*, billable *1h*');
    });
  });

  describe('searches', () => {
    it('suggests only its own users and projects', async () => {
      const projects = await open([
        NavigationActionId.Settings,
        NavigationActionId.Projects,
      ]);
      const timeLogs = await open([
        NavigationActionId.Reports,
        NavigationActionId.TimeLogs,
      ]);
      const assignments = await openModalFrom(
        t,
        a.workspace,
        a.admin,
        projects,
        ProjectsTabViewActionId.ManageProjectMenu,
        `${ProjectsTabViewActionId.ManageProjectAssignments}:${a.website.id}`,
      );

      expect(
        await suggestions(
          projects,
          ProjectsTabViewActionId.FindProjectByName,
          'web',
        ),
      ).toEqual([a.website.id]);
      expect(
        await suggestions(
          timeLogs,
          TimeEntriesTabViewActionId.FilterByProject,
          'web',
        ),
      ).toEqual([a.website.id]);
      expect(
        await suggestions(
          timeLogs,
          TimeEntriesTabViewActionId.FilterByUser,
          'ada',
        ),
      ).toEqual([a.ada.id]);
      expect(
        await suggestions(
          assignments,
          ProjectAssignmentModalViewActionId.ProjectUsers,
          'ada',
        ),
      ).toEqual([a.ada.id]);
    });

    it('searches for the text as typed, not as filter syntax', async () => {
      const timeLogs = await open([
        NavigationActionId.Reports,
        NavigationActionId.TimeLogs,
      ]);
      const search = (query: string) =>
        suggestions(timeLogs, TimeEntriesTabViewActionId.FilterByUser, query);

      // Typed into the search, these would add "or id is not null" or "or
      // role is admin" to an unescaped PostgREST filter.
      expect(await search('zz,id.not.is.null,name.ilike.zz')).toEqual([]);
      expect(await search('zz,role.eq.admin,name.ilike.zz')).toEqual([]);
      expect(await search('ada)')).toEqual([]);
      expect(await search('"ada"')).toEqual([]);
      expect(await search('ada')).toEqual([a.ada.id]);
    });

    it('offers only its own projects when logging time', async () => {
      const logTime = await openModalFrom(
        t,
        a.workspace,
        a.admin,
        await open([]),
        HomeTabActionId.LogTime,
      );

      expect(
        findAction(logTime.blocks, 'projectId').element.initial_option.value,
      ).toBe(a.website.id);
      expect(
        findAction(logTime.blocks, 'projectId').element.options,
      ).toHaveLength(1);
    });
  });
});
