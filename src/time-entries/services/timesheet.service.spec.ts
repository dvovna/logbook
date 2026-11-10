import UserRole from 'src/common/enums/user-role.enum';
import { weekDays, weekStartOf } from 'src/common/utils/period-presets';
import { GetUserProjectsQuery } from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimesheetService } from 'src/time-entries/services/timesheet.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { cellKey } from 'src/time-entries/types/timesheet.types';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TransactionService } from 'src/database/transaction.service';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { IUserViewModel } from 'src/users/types/user.interface';

const WEEK = '2026-06-15';
const MONDAY = '2026-06-15';
const TUESDAY = '2026-06-16';
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
  billable: true,
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
        findOfUserWithBilled: jest.fn(async ({ dateFrom, dateTo }) => ({
          entries: entries.filter(
            (item) => item.work_date >= dateFrom && item.work_date <= dateTo,
          ),
          billedIds: billed,
        })),
      } as unknown as TimeEntriesService,
      {
        findAllWithClientNames: jest.fn(async () =>
          projects.map((item) => ({
            ...item,
            client_name: item.client_id === 'acme' ? 'Acme' : null,
          })),
        ),
      } as unknown as ProjectsService,
      {
        execute: jest.fn(async () => userProjects),
      } as unknown as GetUserProjectsQuery,
      {} as TimeEntriesValidationService,
      {} as TransactionService,
    );
  });

  const formRows = async (
    user: IUserViewModel,
    weekStart: string,
    added: string[],
  ) => (await service.getForm(user, weekStart, added)).week;

  const wednesdayCell = async () => {
    const week = await service.getWeek(userWith(UserRole.Member), WEEK);

    return week.rows[0].cells[2];
  };

  it("sums a project's entries of a day into one cell", async () => {
    entries = [entry('a', 'web', 60), entry('b', 'web', 30)];

    expect(await wednesdayCell()).toEqual({
      date: WEDNESDAY,
      minutes: 90,
      entryCount: 2,
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
      entryCount: 1,
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

  it("shows every project of the week in the table, past the form's 10", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`);
    projects = ids.map((id) => project(id));
    entries = ids.map((id) => entry(`e-${id}`, id, 60));

    const week = await service.getWeek(userWith(UserRole.Member), WEEK);

    expect(week.rows).toHaveLength(12);
    expect(week.total).toBe(12 * 60);
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

    const week = await formRows(userWith(UserRole.Member), WEEK, ['foreign']);

    expect(week.rows).toHaveLength(10);
    const ofRecent = await formRows(userWith(UserRole.Member), WEEK, [
      'new',
      'foreign',
    ]);
    const projectIds = ofRecent.rows.map((row) => row.projectId);

    expect(projectIds).not.toContain('foreign');
    expect(projectIds).not.toContain('old');

    entries = [entry('e1', 'p00', 60)];
    const few = await formRows(userWith(UserRole.Member), WEEK, [
      'new',
      'foreign',
    ]);

    expect(few.rows.map((row) => row.projectId)).toEqual(['new', 'p00']);
    expect(few.rows.every((row) => row.cells.length === 7)).toBe(true);
  });

  it("ranks the shown week's projects, then added ones, before the cut", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `p${String(i).padStart(2, '0')}`,
    );
    projects = [...ids, 'new'].map((id) => project(id));
    userProjects = [...ids, 'new'].map((id) => ({
      id,
      name: `Project ${id}`,
      clientName: '',
    }));
    // p00–p10 have time in an earlier week; p11, last by name, in this one.
    entries = [
      ...ids
        .slice(0, 11)
        .map((id) => entry(`e-${id}`, id, 60, { work_date: '2026-06-03' })),
      entry('e-p11', 'p11', 60),
    ];

    const week = await formRows(userWith(UserRole.Member), WEEK, ['new']);

    expect(week.rows.map((row) => row.projectId)).toEqual([
      'new',
      'p00',
      'p01',
      'p02',
      'p03',
      'p04',
      'p05',
      'p06',
      'p07',
      'p11',
    ]);
  });

  it('leaves out older projects the user may no longer log on', async () => {
    projects = [
      project('web'),
      project('old', { archived_at: '2026-06-01T00:00:00Z' }),
      project('gone'),
      project('closed', { archived_at: '2026-06-01T00:00:00Z' }),
    ];
    // 'gone' was the user's once; 'closed' has time in the shown week.
    entries = [
      entry('e-web', 'web', 60, { work_date: '2026-06-03' }),
      entry('e-old', 'old', 60, { work_date: '2026-06-03' }),
      entry('e-gone', 'gone', 60, { work_date: '2026-06-03' }),
      entry('e-closed', 'closed', 60),
    ];

    const week = await formRows(userWith(UserRole.Member), WEEK, []);

    expect(week.rows.map((row) => row.projectId)).toEqual(['closed', 'web']);
    expect(week.rows[0].cells[2]).toMatchObject({
      minutes: 60,
      lock: 'project',
    });
  });

  it('keeps a project from 4 weeks before the shown one', async () => {
    entries = [entry('e', 'web', 60, { work_date: '2026-05-18' })];

    const week = await formRows(userWith(UserRole.Member), WEEK, []);

    expect(week.rows.map((row) => row.projectId)).toEqual(['web']);
    expect(week.total).toBe(0);
  });

  it('counts the open entries of earlier weeks and finds the oldest week', async () => {
    findMany.mockResolvedValue([
      entry('a', 'web', 60, { work_date: '2026-06-10' }),
      entry('b', 'web', 60, {
        work_date: '2026-06-03',
        status: TimeEntryStatus.Rejected,
      }),
    ]);

    expect(
      await service.findOpenBefore(userWith(UserRole.Member), WEEK),
    ).toEqual({ count: 2, weekStart: '2026-06-01' });
    expect(findMany).toHaveBeenCalledWith({
      userId: 'me',
      slackTeamId: 'team-1',
      statuses: [TimeEntryStatus.Draft, TimeEntryStatus.Rejected],
      dateTo: '2026-06-14',
    });

    findMany.mockResolvedValue([]);

    expect(
      await service.findOpenBefore(userWith(UserRole.Member), WEEK),
    ).toBeNull();
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

describe('TimesheetService.saveCells', () => {
  let entries: ITimeEntryViewModel[];
  let writes: Record<'insertMany' | 'writeMinutes' | 'writeDeletes', jest.Mock>;
  let validation: Record<
    'checkCreate' | 'checkUpdate' | 'checkDelete' | 'checkDailyTotal',
    jest.Mock
  >;
  let lock: jest.Mock;
  let service: TimesheetService;
  const member = userWith(UserRole.Member);

  const serviceWith = (validationService: TimeEntriesValidationService) =>
    new TimesheetService(
      {
        findOfUserWithBilled: jest.fn(async ({ dateFrom, dateTo }) => ({
          entries: entries.filter(
            (item) => item.work_date >= dateFrom && item.work_date <= dateTo,
          ),
          billedIds: new Set(),
        })),
        submit: jest.fn(async () => []),
        ...writes,
      } as unknown as TimeEntriesService,
      {
        findAllWithClientNames: jest.fn(async () => [
          { ...project('web'), client_name: null },
        ]),
      } as unknown as ProjectsService,
      {
        execute: jest.fn(async () => [
          { id: 'web', name: 'Project web', clientName: '' },
        ]),
      } as unknown as GetUserProjectsQuery,
      validationService,
      {
        transaction: async <T>(work: () => Promise<T>) => work(),
        lock,
      } as unknown as TransactionService,
    );

  beforeEach(() => {
    entries = [];
    lock = jest.fn(async () => undefined);
    writes = {
      insertMany: jest.fn(async () => []),
      writeMinutes: jest.fn(async () => []),
      writeDeletes: jest.fn(async () => []),
    };
    validation = {
      checkCreate: jest.fn(),
      checkUpdate: jest.fn(),
      checkDelete: jest.fn(),
      checkDailyTotal: jest.fn(),
    };
    service = serviceWith(
      validation as unknown as TimeEntriesValidationService,
    );
  });

  const expectNothingWritten = () => {
    expect(writes.insertMany).not.toHaveBeenCalled();
    expect(writes.writeMinutes).not.toHaveBeenCalled();
    expect(writes.writeDeletes).not.toHaveBeenCalled();
  };

  it('throws at the first bad cell and writes nothing', async () => {
    entries = [entry('s', 'web', 60, { status: TimeEntryStatus.Submitted })];

    await expect(
      service.saveCells(member, [
        { projectId: 'web', date: MONDAY, minutes: 120, shownMinutes: null },
        { projectId: 'web', date: WEDNESDAY, minutes: 120, shownMinutes: 60 },
        { projectId: 'foreign', date: MONDAY, minutes: 60, shownMinutes: null },
      ]),
    ).rejects.toMatchObject({
      message: 'Submitted time entries cannot be edited',
      field: cellKey('web', WEDNESDAY),
    });
    expectNothingWritten();
  });

  it('skips untouched cells', async () => {
    // The form showed this draft; it was submitted since.
    entries = [entry('s', 'web', 60, { status: TimeEntryStatus.Submitted })];

    const result = await service.saveCells(member, [
      { projectId: 'web', date: WEDNESDAY, minutes: 60, shownMinutes: 60 },
      { projectId: 'web', date: MONDAY, minutes: null, shownMinutes: null },
      { projectId: 'web', date: TUESDAY, minutes: 90, shownMinutes: null },
    ]);

    expect(writes.insertMany).toHaveBeenCalledTimes(1);
    expect(writes.insertMany).toHaveBeenCalledWith(
      [
        {
          params: expect.objectContaining({
            userId: 'me',
            projectId: 'web',
            workDate: new Date(`${TUESDAY}T00:00:00Z`),
            minutes: 90,
            status: TimeEntryStatus.Draft,
          }),
          project: { id: 'web', client_id: null, billable: true },
        },
      ],
      member,
    );
    expect(validation.checkCreate).toHaveBeenCalledTimes(1);
    expect(writes.writeMinutes).not.toHaveBeenCalled();
    expect(result).toEqual({
      minutes: 150,
      minutesByDate: expect.objectContaining({
        [TUESDAY]: 90,
        [WEDNESDAY]: 60,
        [MONDAY]: 0,
      }),
    });
  });

  it('writes the new, changed and deleted entries in one statement each', async () => {
    entries = [
      entry('changed', 'web', 60, { work_date: MONDAY }),
      entry('rejected', 'web', 60, {
        work_date: TUESDAY,
        status: TimeEntryStatus.Rejected,
      }),
      entry('gone', 'web', 120),
    ];

    const result = await service.saveCells(member, [
      { projectId: 'web', date: MONDAY, minutes: 120, shownMinutes: 60 },
      { projectId: 'web', date: TUESDAY, minutes: 30, shownMinutes: 60 },
      { projectId: 'web', date: WEDNESDAY, minutes: null, shownMinutes: 120 },
      { projectId: 'web', date: '2026-06-18', minutes: 45, shownMinutes: null },
    ]);

    expect(writes.insertMany).toHaveBeenCalledTimes(1);
    expect(writes.writeMinutes).toHaveBeenCalledWith(
      new Map([
        ['changed', 120],
        ['rejected', 30],
      ]),
      { status: TimeEntryStatus.Draft },
      member,
      { openOnly: true },
    );
    expect(writes.writeDeletes).toHaveBeenCalledWith([entries[2]], member, {
      openOnly: true,
    });
    expect(result).toMatchObject({ minutes: 195 });
  });

  it('refuses a comment when no cell changed, and writes nothing', async () => {
    entries = [entry('d', 'web', 60)];

    await expect(
      service.saveCells(
        member,
        [
          { projectId: 'web', date: WEDNESDAY, minutes: 60, shownMinutes: 60 },
          { projectId: 'web', date: MONDAY, minutes: null, shownMinutes: null },
        ],
        { comment: 'Sprint review' },
      ),
    ).rejects.toMatchObject({
      message:
        'The comment goes on the entries whose hours you add or change: nothing changed.',
      field: 'comment',
    });
    expectNothingWritten();
  });

  it("saves under the lock of the user's time", async () => {
    await service.saveCells(member, [
      { projectId: 'web', date: MONDAY, minutes: 60, shownMinutes: null },
    ]);

    expect(lock).toHaveBeenCalledWith('timesheet:me');
  });

  it('refuses a cell whose entry was submitted between the check and the write', async () => {
    entries = [entry('d', 'web', 60)];
    writes.writeMinutes.mockResolvedValue(['d']);

    await expect(
      service.saveCells(member, [
        { projectId: 'web', date: WEDNESDAY, minutes: 120, shownMinutes: 60 },
      ]),
    ).rejects.toMatchObject({
      message: 'This time changed after the form opened: open the form again.',
      field: cellKey('web', WEDNESDAY),
    });
    // Only while it is still a draft or rejected, whatever the role.
    expect(writes.writeMinutes).toHaveBeenCalledWith(
      new Map([['d', 120]]),
      { status: TimeEntryStatus.Draft },
      member,
      { openOnly: true },
    );
  });

  it("names the first changed cell in the form's order, whatever its write", async () => {
    entries = [
      entry('gone', 'web', 60, { work_date: MONDAY }),
      entry('changed', 'web', 60, { work_date: TUESDAY }),
    ];
    writes.writeMinutes.mockResolvedValue(['changed']);
    writes.writeDeletes.mockResolvedValue(['gone']);

    await expect(
      service.saveCells(member, [
        { projectId: 'web', date: MONDAY, minutes: null, shownMinutes: 60 },
        { projectId: 'web', date: TUESDAY, minutes: 120, shownMinutes: 60 },
      ]),
    ).rejects.toMatchObject({
      message: 'This time changed after the form opened: open the form again.',
      field: cellKey('web', MONDAY),
    });
  });

  it("counts the cell's cancelled time in the 24 hours, and not the entry it changes", async () => {
    service = serviceWith(
      new TimeEntriesValidationService({} as TimeEntriesRepository),
    );
    entries = [
      entry('cancelled', 'web', 600, {
        status: TimeEntryStatus.Cancelled,
        user_id: 'me',
      }),
      entry('d', 'web', 600, { user_id: 'me' }),
    ];

    // 10h cancelled + 14h: the whole day, with the draft's 10h replaced.
    await service.saveCells(member, [
      { projectId: 'web', date: WEDNESDAY, minutes: 840, shownMinutes: 600 },
    ]);

    await expect(
      service.saveCells(member, [
        { projectId: 'web', date: WEDNESDAY, minutes: 855, shownMinutes: 600 },
      ]),
    ).rejects.toMatchObject({
      message:
        'Total logged time for this project and date cannot exceed 24 hours',
      field: cellKey('web', WEDNESDAY),
    });
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
