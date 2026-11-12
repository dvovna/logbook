import { Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  IVacationsReplacement,
  VacationRequestsService,
} from '@modules/vacation-requests/services/vacation-requests.service';
import UserVacationsCsvParser from '@modules/user-data-import/parsers/user-vacations-csv.parser';
import { UserVacationsImportService } from '@modules/user-data-import/services/user-vacations-import.service';

const person = (name: string): IUserViewModel =>
  ({
    id: `id-${name}`,
    email: `${name}@example.test`,
    slack_team_id: 'w1',
    team_id: null,
    role: UserRole.Member,
  }) as IUserViewModel;

const admin = { ...person('admin'), role: UserRole.Admin };
const [ada, bob, cy] = ['ada', 'bob', 'cy'].map(person);

// A line with one vacation that starts on `start`.
const line = (email: string, start = '2026-03-02') =>
  `${email};2025-09-01;${start};${start};annual_leave;approved`;

const csv = (...lines: string[]) =>
  [
    'email;contractStartDate;vacation[0].startDate;vacation[0].endDate;vacation[0].type;vacation[0].status',
    ...lines,
  ].join('\n');

describe('UserVacationsImportService', () => {
  let replaceVacations: jest.Mock;
  let findMany: jest.Mock;
  let service: UserVacationsImportService;

  beforeEach(() => {
    replaceVacations = jest.fn().mockResolvedValue([]);
    findMany = jest.fn().mockResolvedValue([ada, bob, cy]);
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    service = new UserVacationsImportService(
      { findMany } as unknown as UsersService,
      { replaceVacations } as unknown as VacationRequestsService,
      new UserVacationsCsvParser(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  const replaced = (call: number) =>
    (replaceVacations.mock.calls[call][0] as IVacationsReplacement[]).map(
      ({ user, vacations, contractStartDate }) => [
        user.id,
        vacations.map(({ startDate }) => startDate.toISOString().slice(0, 10)),
        contractStartDate?.toISOString().slice(0, 10),
      ],
    );

  it('reads the people at once and imports every line in one call', async () => {
    const result = await service.handle(
      csv(line(ada.email), line('ghost@example.test'), line(bob.email)),
      admin,
    );

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      emails: [ada.email, 'ghost@example.test', bob.email],
      slackTeamId: 'w1',
    });
    expect(replaceVacations).toHaveBeenCalledTimes(1);
    expect(replaced(0)).toEqual([
      [ada.id, ['2026-03-02'], '2025-09-01'],
      [bob.id, ['2026-03-02'], '2025-09-01'],
    ]);
    expect(result).toEqual({
      created: 0,
      updated: 2,
      skipped: 1,
      errors: ['User not found: ghost@example.test'],
    });
  });

  // As when the lines were imported one after another.
  it('gives a person on two lines the last one, and counts both', async () => {
    const result = await service.handle(
      csv(line(ada.email, '2026-03-02'), line(ada.email, '2026-04-01')),
      admin,
    );

    expect(replaced(0)).toEqual([[ada.id, ['2026-04-01'], '2025-09-01']]);
    expect(result.updated).toBe(2);
  });

  it('imports line by line when the import at once fails, and reports the lines that fail, in order', async () => {
    replaceVacations.mockImplementation(
      async (replacements: IVacationsReplacement[]) => {
        if (replacements.some(({ user }) => user.id === bob.id)) {
          throw new Error('[vacation_requests] createMany error: refused');
        }

        return [];
      },
    );

    const result = await service.handle(
      csv(
        line(ada.email),
        line(bob.email),
        line('ghost@example.test'),
        line(cy.email),
      ),
      admin,
    );

    expect(replaceVacations).toHaveBeenCalledTimes(4);
    expect([1, 2, 3].map((call) => replaced(call)[0][0])).toEqual([
      ada.id,
      bob.id,
      cy.id,
    ]);
    expect(result).toEqual({
      created: 0,
      updated: 2,
      skipped: 2,
      errors: [
        `Failed to import ${bob.email}: [vacation_requests] createMany error: refused`,
        'User not found: ghost@example.test',
      ],
    });
  });

  it('imports nothing when a line is invalid', async () => {
    const result = await service.handle(
      csv(
        line(ada.email),
        `${bob.email};2025-09-01;2026-03-02;2026-03-02;holiday;approved`,
      ),
      admin,
    );

    expect(findMany).not.toHaveBeenCalled();
    expect(replaceVacations).not.toHaveBeenCalled();
    expect(result.errors).toEqual([
      expect.stringContaining(
        `Vacation 1 for ${bob.email} is invalid: field type should be one of`,
      ),
    ]);
  });
});
