import UserRole from 'src/common/enums/user-role.enum';
import { weekDays, weekStartOf } from 'src/common/utils/period-presets';
import ClientsService from 'src/clients/services/clients.service';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';

const WEEK = '2026-06-15';
const WEDNESDAY = '2026-06-17';

const userWith = (role: UserRole) =>
  ({ id: 'me', role, slack_team_id: 'team-1' }) as IUserViewModel;

const entry = (
  id: string,
  projectId: string,
  minutes: number,
  fields: Partial<ITimeEntryViewModel> = {},
) =>
  ({
    id,
    project_id: projectId,
    work_date: WEDNESDAY,
    minutes,
    status: TimeEntryStatus.Draft,
    ...fields,
  }) as ITimeEntryViewModel;

const project = (id: string, fields: Record<string, unknown> = {}) => ({
  id,
  name: `Project ${id}`,
  client_id: null,
  archived_at: null,
  ...fields,
});

describe('TimesheetService', () => {
  let entries: ITimeEntryViewModel[];
  let projects: ReturnType<typeof project>[];
  let billed: Set<string>;
  let userProjects: { id: string; name: string; clientName: string }[];
  let findMany: jest.Mock;
  let service: TimesheetService;

  beforeEach(() => {
    entries = [];
    projects = [project('web')];
    billed = new Set();
    userProjects = [{ id: 'web', name: 'Project web', clientName: '' }];
    findMany = jest.fn(async ({ dateFrom, dateTo }) =>
      entries.filter(
        (item) => item.work_date >= dateFrom && item.work_date <= dateTo,
      ),
    );
    service = new TimesheetService(
      {
        findMany,
        findBilledIds: jest.fn(async () => billed),
      } as unknown as TimeEntriesService,
      {
        findMany: jest.fn(async ({ includeArchived }) =>
          projects.filter((item) => includeArchived || !item.archived_at),
        ),
      } as unknown as ProjectsService,
      {
        findMany: jest.fn(async () => [{ id: 'acme', name: 'Acme' }]),
      } as unknown as ClientsService,
      {
        execute: jest.fn(async () => userProjects),
      } as unknown as GetUserProjectsQuery,
    );
  });

  const wednesdayCell = async () => {
    const week = await service.getWeek(userWith(UserRole.Member), WEEK);

    return week.rows[0].cells[2];
  };

  it("sums a project's entries of a day into one cell", async () => {
    entries = [entry('a', 'web', 60), entry('b', 'web', 30)];

    expect(await wednesdayCell()).toEqual({
      date: WEDNESDAY,
      minutes: 90,
      entryId: null,
      lock: 'several',
    });
  });

  it("locks a cell by its one entry's status or billing", async () => {
    const lockOf = async (item: ITimeEntryViewModel) => {
      entries = [item];

      return wednesdayCell();
    };

    expect(
      (
        await lockOf(
          entry('s', 'web', 60, { status: TimeEntryStatus.Submitted }),
        )
      ).lock,
    ).toBe('submitted');
    expect(
      (
        await lockOf(
          entry('p', 'web', 60, { status: TimeEntryStatus.Approved }),
        )
      ).lock,
    ).toBe('approved');

    billed = new Set(['d']);
    expect((await lockOf(entry('d', 'web', 60))).lock).toBe('billed');

    billed = new Set();
    expect(await lockOf(entry('d', 'web', 60))).toEqual({
      date: WEDNESDAY,
      minutes: 60,
      entryId: 'd',
      lock: null,
    });
  });

  it("shows a week's archived project with its hours", async () => {
    projects = [project('old', { archived_at: '2026-06-01T00:00:00Z' })];
    entries = [entry('a', 'old', 120)];

    const week = await service.getWeek(userWith(UserRole.Member), WEEK);

    expect(week.rows.map((row) => row.projectId)).toEqual(['old']);
    expect(week.rows[0].cells.every((cell) => cell.lock === 'project')).toBe(
      true,
    );
    expect(week.rows[0].cells[2].minutes).toBe(120);
    expect(week.total).toBe(120);
    expect(week.dayTotals).toEqual([0, 0, 120, 0, 0, 0, 0]);
    expect(week.statusCounts[TimeEntryStatus.Draft]).toBe(1);
  });

  it('offers recent projects and added ones, at most 10', async () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `p${String(i).padStart(2, '0')}`,
    );
    projects = [...ids, 'old', 'new', 'foreign'].map((id) => project(id));
    userProjects = [...ids, 'old', 'new'].map((id) => ({
      id,
      name: `Project ${id}`,
      clientName: '',
    }));
    entries = [
      ...ids.map((id) => entry(`e-${id}`, id, 60)),
      entry('e-old', 'old', 60, { work_date: '2026-05-11' }),
    ];

    const week = await service.getFormRows(userWith(UserRole.Member), WEEK, [
      'foreign',
    ]);

    expect(week.rows).toHaveLength(10);
    const ofRecent = await service.getFormRows(
      userWith(UserRole.Member),
      WEEK,
      ['new', 'foreign'],
    );
    const projectIds = ofRecent.rows.map((row) => row.projectId);

    expect(projectIds).not.toContain('foreign');
    expect(projectIds).not.toContain('old');

    entries = [entry('e1', 'p00', 60)];
    const few = await service.getFormRows(userWith(UserRole.Member), WEEK, [
      'new',
      'foreign',
    ]);

    expect(few.rows.map((row) => row.projectId)).toEqual(['new', 'p00']);
    expect(few.rows.every((row) => row.cells.length === 7)).toBe(true);
  });

  it('keeps a project from 4 weeks before the shown one', async () => {
    entries = [entry('e', 'web', 60, { work_date: '2026-05-18' })];

    const week = await service.getFormRows(userWith(UserRole.Member), WEEK, []);

    expect(week.rows.map((row) => row.projectId)).toEqual(['web']);
    expect(week.total).toBe(0);
  });

  it('lets Admin and HR add any active project', async () => {
    projects = [project('web'), project('free', { client_id: 'acme' })];

    const admin = await service.allowedProjects(userWith(UserRole.Admin));

    expect(admin.map((item) => item.id)).toEqual(['free', 'web']);
    expect(admin[0].clientName).toBe('Acme');
    expect(await service.allowedProjects(userWith(UserRole.Member))).toBe(
      userProjects,
    );
  });
});

describe('weeks', () => {
  it('starts a week on Monday', () => {
    expect(weekStartOf('2027-01-01')).toBe('2026-12-28');
    expect(weekStartOf('2026-12-28')).toBe('2026-12-28');
    expect(weekStartOf('2027-01-03')).toBe('2026-12-28');
  });

  it('lists the seven days', () => {
    const days = weekDays('2026-12-28');

    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-12-28');
    expect(days[6]).toBe('2027-01-03');
  });
});
