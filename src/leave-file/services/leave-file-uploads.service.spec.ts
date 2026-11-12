import { NotFoundException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { DAY_MS } from '@common/utils/date.utils';
import { digestOf } from '@common/utils/digest.utils';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  ICountedRequest,
  IStoredBalance,
} from '@modules/vacation-requests/utils/leave-balance.utils';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { LeaveFileUploadsRepository } from 'src/leave-file/repositories/leave-file-uploads.repository';
import { planLeaveBalances } from 'src/leave-file/services/leave-balances-planner';
import { LeaveFileStateService } from 'src/leave-file/services/leave-file-state.service';
import { LeaveFileUndoService } from 'src/leave-file/services/leave-file-undo.service';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import { planLeaveHistory } from 'src/leave-file/services/leave-history-planner';
import { IStoredLeaveBalancesState } from 'src/leave-file/types/leave-balances-plan.interface';
import {
  ILeaveBalanceRow,
  ILeaveHistoryRow,
} from 'src/leave-file/types/leave-file-row.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';
import { ILeaveHistoryState } from 'src/leave-file/types/leave-history-plan.interface';

const UPLOAD_ID = '3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11';

const user = {
  id: 'hr-1',
  role: UserRole.HR,
  slack_team_id: 'workspace-1',
} as IUserViewModel;

const POLICY = {
  id: 'policy-1',
  vacation_days: 26,
  working_days: 20,
  carryover_days: 5,
  bonus_days: 3,
} as IVacationPolicyViewModel;

const person = (id: string, fields: Partial<IUserViewModel> = {}) =>
  ({
    id,
    email: `${id}@x.test`,
    name: id,
    role: UserRole.Member,
    is_active: true,
    contract_start_date: null,
    carryover_days: null,
    team_id: null,
    slack_team_id: 'workspace-1',
    slack_id: `S${id}`,
    created_at: '2026-01-01T00:00:00Z',
    ...fields,
  }) as IUserViewModel;

const anna = person('anna', { team_id: 'team-1' });
const ben = person('ben');

const weekdays = (start: string, end: string) => {
  const dates: string[] = [];
  for (
    const day = new Date(`${start}T00:00:00Z`);
    day <= new Date(`${end}T00:00:00Z`);
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    if (![0, 6].includes(day.getUTCDay())) {
      dates.push(day.toISOString().slice(0, 10));
    }
  }
  return dates;
};

const historyState = (
  requests: ICountedRequest[] = [],
): ILeaveHistoryState => ({
  today: '2026-11-12',
  people: [anna, ben],
  policyOf: new Map([
    ['anna', POLICY],
    ['ben', POLICY],
  ]),
  requestsOf: new Map([['anna', requests]]),
  balanceOf: new Map(),
  workingDatesOf: (_userId, startDate, endDate) => weekdays(startDate, endDate),
});

// Anna had a balance from an older file; Ben had none.
const annaEarlier: IStoredBalance = {
  balanceOn: '2026-06-01',
  daysLeft: 3,
  workingDaysLeft: null,
  bonusDaysLeft: null,
  uploadId: 'older-upload',
  setBy: 'hr-2',
  updatedAt: '2026-06-01T10:00:00.000000+00:00',
};

const balancesState = (): IStoredLeaveBalancesState => ({
  today: '2026-11-12',
  people: [anna, ben],
  policyOf: new Map([
    ['anna', POLICY],
    ['ben', POLICY],
  ]),
  requestsOf: new Map(),
  balanceOf: new Map([['anna', annaEarlier]]),
});

const historyRow = (
  n: number,
  email: string,
  from: string,
  to: string,
  comment = '',
): ILeaveHistoryRow => ({
  row: n,
  name: '',
  email,
  leaveType: 'Annual leave',
  from,
  to,
  comment,
});

const balanceRow = (
  n: number,
  email: string,
  fields: Partial<ILeaveBalanceRow> = {},
): ILeaveBalanceRow => ({
  row: n,
  name: '',
  email,
  contractStart: '',
  balanceOn: '2026-11-12',
  daysLeft: '',
  workingDaysLeft: '',
  bonusDaysLeft: '',
  ...fields,
});

const historyRows = [
  historyRow(2, 'anna@x.test', '2026-03-02', '2026-03-06', 'Agreed by email'),
  historyRow(3, 'ben@x.test', '2026-12-21', '2026-12-23'),
];

const balanceRows = [
  balanceRow(2, 'anna@x.test', { contractStart: '2021-04-15', daysLeft: '12' }),
  balanceRow(3, 'ben@x.test', { daysLeft: '5', bonusDaysLeft: '1' }),
];

describe('LeaveFileUploadsService', () => {
  const calls: string[] = [];
  const stored = { id: UPLOAD_ID } as ILeaveFileUpload;

  const build = () => {
    calls.length = 0;
    const repository = {
      supersedePreviewed: jest.fn(async () => {
        calls.push('supersede');
      }),
      create: jest.fn(async () => {
        calls.push('create');

        return stored;
      }),
      cancelPreviewed: jest.fn(),
      setMessage: jest.fn(),
      findOne: jest.fn(async () => {
        calls.push('find upload');

        return null as ILeaveFileUpload | null;
      }),
      setDigest: jest.fn(async () => {
        calls.push('set digest');
      }),
      markApplied: jest.fn(async () => {
        calls.push('mark applied');

        return stored;
      }),
      hasApplied: jest.fn(),
    };
    const stateService = {
      balancesState: jest.fn(async () => {
        calls.push('read balances state');

        return balancesState();
      }),
      historyState: jest.fn(async () => {
        calls.push('read history state');

        return historyState();
      }),
    };
    const vacationRequestsService = {
      addImported: jest.fn(async () => {
        calls.push('add imported');

        return [
          { id: 'request-1', updated_at: '2026-11-12T10:00:00.000001+00:00' },
          { id: 'request-2', updated_at: '2026-11-12T10:00:00.000001+00:00' },
        ] as IVacationRequestViewModel[];
      }),
    };
    const leaveBalancesService = {
      setMany: jest.fn(async () => {
        calls.push('set balances');

        return [
          { user_id: 'anna', updated_at: '2026-11-12T10:00:00.000002+00:00' },
          { user_id: 'ben', updated_at: '2026-11-12T10:00:00.000003+00:00' },
        ] as ILeaveBalance[];
      }),
    };
    const usersService = {
      setContractStartDates: jest.fn(async () => {
        calls.push('set contract starts');
      }),
      findOne: jest.fn(),
    };
    const transactions = {
      transaction: jest.fn(async (work: () => Promise<unknown>) => {
        calls.push('begin');

        return work();
      }),
      lock: jest.fn(async () => {
        calls.push('lock');
      }),
    };
    const undoService = { undo: jest.fn() };
    const service = new LeaveFileUploadsService(
      repository as unknown as LeaveFileUploadsRepository,
      stateService as unknown as LeaveFileStateService,
      vacationRequestsService as unknown as VacationRequestsService,
      leaveBalancesService as unknown as LeaveBalancesService,
      usersService as unknown as UsersService,
      transactions as unknown as TransactionService,
      undoService as unknown as LeaveFileUndoService,
    );

    return {
      service,
      undoService,
      repository,
      stateService,
      vacationRequestsService,
      leaveBalancesService,
      usersService,
      transactions,
    };
  };

  describe('receive', () => {
    it('plans a history file against the workspace and keeps its rows and the plan digest', async () => {
      const { service, repository, stateService } = build();

      const { upload, preview } = await service.receive(
        { kind: LeaveFileKind.History, rows: historyRows },
        'leave-history.csv',
        user,
      );

      const plan = planLeaveHistory(historyRows, historyState());
      expect(stateService.historyState).toHaveBeenCalledWith(
        'workspace-1',
        historyRows,
      );
      expect(upload).toBe(stored);
      expect(preview).toEqual({
        kind: LeaveFileKind.History,
        plan,
        people: [anna, ben],
      });
      expect(plan.add).toHaveLength(2);
      expect(repository.create).toHaveBeenCalledWith({
        slack_team_id: 'workspace-1',
        uploaded_by: 'hr-1',
        kind: LeaveFileKind.History,
        file_name: 'leave-history.csv',
        rows: JSON.stringify(historyRows),
        plan_digest: digestOf(plan),
        status: LeaveFileUploadStatus.Previewed,
        created_at: expect.any(String),
      });
    });

    it('plans a balances file against the balances state', async () => {
      const { service, repository, stateService } = build();

      const { preview } = await service.receive(
        { kind: LeaveFileKind.Balances, rows: balanceRows },
        'leave-balances.csv',
        user,
      );

      const plan = planLeaveBalances(balanceRows, balancesState());
      expect(stateService.balancesState).toHaveBeenCalledWith('workspace-1');
      expect(stateService.historyState).not.toHaveBeenCalled();
      expect(preview).toEqual({
        kind: LeaveFileKind.Balances,
        plan,
        people: [anna, ben],
      });
      expect(plan.balances.map(({ userId }) => userId)).toEqual([
        'anna',
        'ben',
      ]);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: LeaveFileKind.Balances,
          rows: JSON.stringify(balanceRows),
          plan_digest: digestOf(plan),
        }),
      );
    });

    it("reads the workspace first, then takes the workspace's lock and supersedes the open preview of the file's kind in one transaction", async () => {
      const { service, repository } = build();

      await service.receive(
        { kind: LeaveFileKind.Balances, rows: [] },
        'leave-balances.csv',
        user,
      );

      expect(calls).toEqual([
        'read balances state',
        'begin',
        'lock',
        'supersede',
        'create',
      ]);
      expect(repository.supersedePreviewed).toHaveBeenCalledWith(
        'workspace-1',
        LeaveFileKind.Balances,
      );
    });
  });

  describe('undo', () => {
    it('is the undo service’s', async () => {
      const built = build();
      const result = { kind: 'closed', reason: 'it was already undone' };

      built.undoService.undo.mockResolvedValue(result);

      await expect(built.service.undo(UPLOAD_ID, user)).resolves.toBe(result);
      expect(built.undoService.undo).toHaveBeenCalledWith(UPLOAD_ID, user);
    });
  });

  describe('cancel', () => {
    it("cancels a preview of the user's workspace", async () => {
      const { service, repository } = build();
      repository.cancelPreviewed.mockResolvedValue(stored);

      await expect(service.cancel(UPLOAD_ID, user)).resolves.toBe(stored);
      expect(repository.cancelPreviewed).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
      );
    });

    it('refuses an upload that is not an open preview of the workspace', async () => {
      const { service, repository } = build();
      repository.cancelPreviewed.mockResolvedValue(null);

      await expect(service.cancel(UPLOAD_ID, user)).rejects.toThrow(
        new NotFoundException('This preview is no longer open.'),
      );
    });

    it('refuses an ID that is no UUID without asking the database', async () => {
      const { service, repository } = build();

      await expect(service.cancel('not-an-id', user)).rejects.toThrow(
        NotFoundException,
      );
      expect(repository.cancelPreviewed).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const historyDigest = digestOf(
      planLeaveHistory(historyRows, historyState()),
    );
    const balancesDigest = digestOf(
      planLeaveBalances(balanceRows, balancesState()),
    );
    const upload = (fields: Partial<ILeaveFileUpload> = {}) =>
      ({
        id: UPLOAD_ID,
        slack_team_id: 'workspace-1',
        kind: LeaveFileKind.History,
        file_name: 'leave-history.csv',
        rows: historyRows,
        plan_digest: historyDigest,
        status: LeaveFileUploadStatus.Previewed,
        created_at: new Date(Date.now() - DAY_MS).toISOString(),
        ...fields,
      }) as ILeaveFileUpload;
    const balancesUpload = (fields: Partial<ILeaveFileUpload> = {}) =>
      upload({
        kind: LeaveFileKind.Balances,
        file_name: 'leave-balances.csv',
        rows: balanceRows,
        plan_digest: balancesDigest,
        ...fields,
      });

    const buildWith = (found: ILeaveFileUpload | null) => {
      const built = build();
      built.repository.findOne.mockImplementation(async () => {
        calls.push('find upload');

        return found;
      });

      return built;
    };

    const expectNothingWritten = ({
      repository,
      vacationRequestsService,
      leaveBalancesService,
      usersService,
    }: ReturnType<typeof build>) => {
      expect(vacationRequestsService.addImported).not.toHaveBeenCalled();
      expect(leaveBalancesService.setMany).not.toHaveBeenCalled();
      expect(usersService.setContractStartDates).not.toHaveBeenCalled();
      expect(repository.markApplied).not.toHaveBeenCalled();
    };

    it("adds a history file's leaves to each person's current team under the workspace's lock, and keeps what it added for Undo", async () => {
      const built = buildWith(upload());
      const { service, repository, stateService, vacationRequestsService } =
        built;

      const result = await service.apply(UPLOAD_ID, historyDigest, user);

      expect(calls).toEqual([
        'begin',
        'lock',
        'find upload',
        'read history state',
        'add imported',
        'mark applied',
      ]);
      expect(repository.findOne).toHaveBeenCalledWith({
        id: UPLOAD_ID,
        slack_team_id: 'workspace-1',
      });
      expect(stateService.historyState).toHaveBeenCalledWith(
        'workspace-1',
        historyRows,
      );
      expect(vacationRequestsService.addImported).toHaveBeenCalledWith(
        [
          {
            userId: 'anna',
            teamId: 'team-1',
            type: VacationType.AnnualLeave,
            startDate: '2026-03-02',
            endDate: '2026-03-06',
            comment: 'Agreed by email',
          },
          {
            userId: 'ben',
            teamId: null,
            type: VacationType.AnnualLeave,
            startDate: '2026-12-21',
            endDate: '2026-12-23',
            comment: null,
          },
        ],
        user,
        UPLOAD_ID,
      );
      expect(repository.markApplied).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
        {
          kind: LeaveFileKind.History,
          requests: [
            {
              id: 'request-1',
              updatedAt: '2026-11-12T10:00:00.000001+00:00',
            },
            {
              id: 'request-2',
              updatedAt: '2026-11-12T10:00:00.000001+00:00',
            },
          ],
        },
      );
      expect(result).toEqual({
        kind: 'applied',
        preview: {
          kind: LeaveFileKind.History,
          plan: planLeaveHistory(historyRows, historyState()),
          people: [anna, ben],
        },
        upload: stored,
      });
    });

    it("sets a balances file's balances and contract starts, and keeps each person's earlier balance for Undo", async () => {
      const built = buildWith(balancesUpload());
      const { service, repository, leaveBalancesService, usersService } = built;

      const result = await service.apply(UPLOAD_ID, balancesDigest, user);

      expect(calls).toEqual([
        'begin',
        'lock',
        'find upload',
        'read balances state',
        'set balances',
        'set contract starts',
        'mark applied',
      ]);
      expect(leaveBalancesService.setMany).toHaveBeenCalledWith(
        [
          {
            userId: 'anna',
            balanceOn: '2026-11-12',
            daysLeft: 12,
            workingDaysLeft: null,
            bonusDaysLeft: null,
          },
          {
            userId: 'ben',
            balanceOn: '2026-11-12',
            daysLeft: 5,
            workingDaysLeft: null,
            bonusDaysLeft: 1,
          },
        ],
        UPLOAD_ID,
        user,
      );
      expect(usersService.setContractStartDates).toHaveBeenCalledWith(
        [{ userId: 'anna', contractStartDate: new Date('2021-04-15') }],
        user,
      );
      expect(repository.markApplied).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
        {
          kind: LeaveFileKind.Balances,
          balances: [
            {
              userId: 'anna',
              before: annaEarlier,
              updatedAt: '2026-11-12T10:00:00.000002+00:00',
            },
            {
              userId: 'ben',
              before: null,
              updatedAt: '2026-11-12T10:00:00.000003+00:00',
            },
          ],
          contractStarts: [
            { userId: 'anna', before: null, after: '2021-04-15' },
          ],
        },
      );
      expect(result).toMatchObject({
        kind: 'applied',
        preview: { kind: LeaveFileKind.Balances, people: [anna, ben] },
        upload: stored,
      });
    });

    it('stores the new digest and applies nothing when the workspace changed since the preview', async () => {
      const found = upload({ plan_digest: 'what the preview showed' });
      const built = buildWith(found);

      const result = await built.service.apply(
        UPLOAD_ID,
        'what the preview showed',
        user,
      );

      expect(built.repository.setDigest).toHaveBeenCalledWith(
        UPLOAD_ID,
        'workspace-1',
        historyDigest,
      );
      expect(result).toEqual({
        kind: 'changed',
        preview: {
          kind: LeaveFileKind.History,
          plan: planLeaveHistory(historyRows, historyState()),
          people: [anna, ben],
        },
        upload: { ...found, plan_digest: historyDigest },
      });
      expectNothingWritten(built);
    });

    it('applies nothing on a click on an older preview, even when the stored digest is the current plan', async () => {
      const built = buildWith(upload());

      await expect(
        built.service.apply(UPLOAD_ID, 'what an older preview showed', user),
      ).resolves.toMatchObject({
        kind: 'changed',
        upload: { id: UPLOAD_ID, plan_digest: historyDigest },
      });
      expect(built.repository.setDigest).not.toHaveBeenCalled();
      expectNothingWritten(built);
    });

    it('marks nothing applied when the plan changes nothing', async () => {
      // Both leaves are in Logbook already.
      const known = historyRows.map((row, i) => ({
        id: `known-${i}`,
        status: VacationRequestStatus.Approved,
        type: VacationType.AnnualLeave,
        startDate: row.from,
        endDate: row.to,
        workingDates: weekdays(row.from, row.to),
      }));
      const state: ILeaveHistoryState = {
        ...historyState(known),
        requestsOf: new Map([
          ['anna', [known[0]]],
          ['ben', [known[1]]],
        ]),
      };
      const plan = planLeaveHistory(historyRows, state);
      const found = upload({ plan_digest: digestOf(plan) });
      const built = buildWith(found);
      built.stateService.historyState.mockImplementation(async () => {
        calls.push('read history state');

        return state;
      });

      await expect(
        built.service.apply(UPLOAD_ID, digestOf(plan), user),
      ).resolves.toEqual({
        kind: 'nothing',
        preview: { kind: LeaveFileKind.History, plan, people: [anna, ben] },
        upload: found,
      });
      expect(plan.skipped).toBe(2);
      expect(built.repository.setDigest).not.toHaveBeenCalled();
      expectNothingWritten(built);
    });

    it.each([
      LeaveFileUploadStatus.Superseded,
      LeaveFileUploadStatus.Canceled,
      LeaveFileUploadStatus.Applied,
      LeaveFileUploadStatus.Undone,
    ])('changes nothing on an upload that is %s', async (status) => {
      const found = upload({ status });
      const built = buildWith(found);

      await expect(
        built.service.apply(UPLOAD_ID, historyDigest, user),
      ).resolves.toEqual({ kind: 'closed', status, upload: found });
      expect(calls).toEqual(['begin', 'lock', 'find upload']);
      expect(built.repository.setDigest).not.toHaveBeenCalled();
      expectNothingWritten(built);
    });

    it('changes nothing on a preview posted more than 7 days ago', async () => {
      const found = upload({
        created_at: new Date(Date.now() - 7 * DAY_MS - 60_000).toISOString(),
      });
      const built = buildWith(found);

      await expect(
        built.service.apply(UPLOAD_ID, historyDigest, user),
      ).resolves.toEqual({ kind: 'closed', status: 'expired', upload: found });
      expect(calls).toEqual(['begin', 'lock', 'find upload']);
      expectNothingWritten(built);
    });

    it("refuses an ID that is not one of the workspace's uploads", async () => {
      const built = buildWith(null);

      await expect(
        built.service.apply(UPLOAD_ID, historyDigest, user),
      ).rejects.toThrow(
        new NotFoundException('This preview is no longer open.'),
      );
      expectNothingWritten(built);
    });

    it('refuses an ID that is no UUID without asking the database', async () => {
      const built = buildWith(upload());

      await expect(
        built.service.apply('not-an-id', historyDigest, user),
      ).rejects.toThrow(
        new NotFoundException('This preview is no longer open.'),
      );
      expect(built.repository.findOne).not.toHaveBeenCalled();
      expect(built.transactions.transaction).not.toHaveBeenCalled();
    });
  });

  describe('findImport', () => {
    const uploader = person('hr-1', { role: UserRole.HR });

    it('names the file, who uploaded it and when it was applied', async () => {
      const { service, repository, usersService } = build();
      repository.findOne.mockResolvedValue({
        id: UPLOAD_ID,
        file_name: 'leave-history.csv',
        uploaded_by: 'hr-1',
        applied_at: '2026-11-12T10:00:00.000000+00:00',
      } as ILeaveFileUpload);
      usersService.findOne.mockResolvedValue(uploader);

      await expect(
        service.findImport(UPLOAD_ID, 'workspace-1'),
      ).resolves.toEqual({
        fileName: 'leave-history.csv',
        uploadedBy: uploader,
        appliedAt: '2026-11-12T10:00:00.000000+00:00',
      });
      expect(repository.findOne).toHaveBeenCalledWith({
        id: UPLOAD_ID,
        slack_team_id: 'workspace-1',
      });
      expect(usersService.findOne).toHaveBeenCalledWith({
        id: 'hr-1',
        slackTeamId: 'workspace-1',
        includeInactive: true,
      });
    });

    it('names nobody when the uploader is gone', async () => {
      const { service, repository, usersService } = build();
      repository.findOne.mockResolvedValue({
        id: UPLOAD_ID,
        file_name: 'leave-history.csv',
        uploaded_by: null,
        applied_at: '2026-11-12T10:00:00.000000+00:00',
      } as ILeaveFileUpload);

      await expect(
        service.findImport(UPLOAD_ID, 'workspace-1'),
      ).resolves.toMatchObject({ uploadedBy: null });
      expect(usersService.findOne).not.toHaveBeenCalled();
    });

    it('finds nothing of an upload that was never applied, or of no upload', async () => {
      const { service, repository } = build();
      repository.findOne.mockResolvedValueOnce({
        id: UPLOAD_ID,
        applied_at: null,
      } as ILeaveFileUpload);
      repository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.findImport(UPLOAD_ID, 'workspace-1'),
      ).resolves.toBeNull();
      await expect(
        service.findImport(UPLOAD_ID, 'workspace-1'),
      ).resolves.toBeNull();
      await expect(
        service.findImport('not-an-id', 'workspace-1'),
      ).resolves.toBeNull();
      expect(repository.findOne).toHaveBeenCalledTimes(2);
    });
  });

  it("tells whether the workspace applied any leave file, and keeps a preview's message", async () => {
    const { service, repository } = build();
    repository.hasApplied.mockResolvedValue(true);

    await expect(service.hasApplied('workspace-1')).resolves.toBe(true);
    await service.setMessage(UPLOAD_ID, 'workspace-1', 'D123', '1.2');

    expect(repository.hasApplied).toHaveBeenCalledWith('workspace-1');
    expect(repository.setMessage).toHaveBeenCalledWith(
      UPLOAD_ID,
      'workspace-1',
      'D123',
      '1.2',
    );
  });
});
