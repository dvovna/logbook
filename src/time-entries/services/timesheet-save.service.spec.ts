import { timesheetLock } from 'src/database/advisory-locks';
import UserRole from 'src/common/enums/user-role.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimesheetSaveService } from 'src/time-entries/services/timesheet-save.service';
import { TimesheetWeekService } from 'src/time-entries/services/timesheet-week.service';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimesheetCellError } from 'src/time-entries/errors/timesheet-cell.error';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TransactionService } from 'src/database/transaction.service';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { IUserViewModel } from 'src/users/types/user.interface';

const MONDAY = '2026-06-15';
const TUESDAY = '2026-06-16';
const WEDNESDAY = '2026-06-17';

const member = {
  id: 'me',
  role: UserRole.Member,
  slack_team_id: 'team-1',
} as IUserViewModel;

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

describe('TimesheetSaveService', () => {
  let entries: ITimeEntryViewModel[];
  let writes: Record<'insertMany' | 'writeMinutes' | 'writeDeletes', jest.Mock>;
  let validation: Record<
    'checkCreate' | 'checkUpdate' | 'checkDelete' | 'checkDailyTotal',
    jest.Mock
  >;
  let lock: jest.Mock;
  let service: TimesheetSaveService;

  const serviceWith = (validationService: TimeEntriesValidationService) =>
    new TimesheetSaveService(
      {
        loadProjects: jest.fn(async () => ({
          projects: new Map([
            [
              'web',
              {
                id: 'web',
                name: 'Project web',
                clientId: null,
                clientName: null,
                billable: true,
                archived: false,
              },
            ],
          ]),
          allowed: [
            { id: 'web', name: 'Project web', clientId: '', clientName: '' },
          ],
        })),
        findEntries: jest.fn(async (_user, dateFrom, dateTo) => ({
          entries: entries.filter(
            (item) => item.work_date >= dateFrom && item.work_date <= dateTo,
          ),
          billedIds: new Set(),
        })),
      } as unknown as TimesheetWeekService,
      { submit: jest.fn(async () => []) } as unknown as TimeEntriesService,
      writes as unknown as TimeEntryWriter,
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

    const error = await service
      .saveCells(member, [
        { projectId: 'web', date: MONDAY, minutes: 120, expectedMinutes: null },
        {
          projectId: 'web',
          date: WEDNESDAY,
          minutes: 120,
          expectedMinutes: 60,
        },
        {
          projectId: 'foreign',
          date: MONDAY,
          minutes: 60,
          expectedMinutes: null,
        },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(TimesheetCellError);
    expect(error).toMatchObject({
      cell: { projectId: 'web', date: WEDNESDAY },
      lock: 'submitted',
    });
    expectNothingWritten();
  });

  it('skips untouched cells', async () => {
    // The form showed this draft; it was submitted since.
    entries = [entry('s', 'web', 60, { status: TimeEntryStatus.Submitted })];

    const result = await service.saveCells(member, [
      { projectId: 'web', date: WEDNESDAY, minutes: 60, expectedMinutes: 60 },
      { projectId: 'web', date: MONDAY, minutes: null, expectedMinutes: null },
      { projectId: 'web', date: TUESDAY, minutes: 90, expectedMinutes: null },
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
      { projectId: 'web', date: MONDAY, minutes: 120, expectedMinutes: 60 },
      { projectId: 'web', date: TUESDAY, minutes: 30, expectedMinutes: 60 },
      {
        projectId: 'web',
        date: WEDNESDAY,
        minutes: null,
        expectedMinutes: 120,
      },
      {
        projectId: 'web',
        date: '2026-06-18',
        minutes: 45,
        expectedMinutes: null,
      },
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
          {
            projectId: 'web',
            date: WEDNESDAY,
            minutes: 60,
            expectedMinutes: 60,
          },
          {
            projectId: 'web',
            date: MONDAY,
            minutes: null,
            expectedMinutes: null,
          },
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
      { projectId: 'web', date: MONDAY, minutes: 60, expectedMinutes: null },
    ]);

    expect(lock).toHaveBeenCalledWith(timesheetLock('me'));
  });

  it('refuses a cell whose entry was submitted between the check and the write', async () => {
    entries = [entry('d', 'web', 60)];
    writes.writeMinutes.mockResolvedValue(['d']);

    await expect(
      service.saveCells(member, [
        {
          projectId: 'web',
          date: WEDNESDAY,
          minutes: 120,
          expectedMinutes: 60,
        },
      ]),
    ).rejects.toMatchObject({
      message: 'This time changed after the form opened: open the form again.',
      cell: { projectId: 'web', date: WEDNESDAY },
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
        { projectId: 'web', date: MONDAY, minutes: null, expectedMinutes: 60 },
        { projectId: 'web', date: TUESDAY, minutes: 120, expectedMinutes: 60 },
      ]),
    ).rejects.toMatchObject({
      message: 'This time changed after the form opened: open the form again.',
      cell: { projectId: 'web', date: MONDAY },
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
      { projectId: 'web', date: WEDNESDAY, minutes: 840, expectedMinutes: 600 },
    ]);

    await expect(
      service.saveCells(member, [
        {
          projectId: 'web',
          date: WEDNESDAY,
          minutes: 855,
          expectedMinutes: 600,
        },
      ]),
    ).rejects.toMatchObject({
      message:
        'Total logged time for this project and date cannot exceed 24 hours',
      cell: { projectId: 'web', date: WEDNESDAY },
    });
  });
});
