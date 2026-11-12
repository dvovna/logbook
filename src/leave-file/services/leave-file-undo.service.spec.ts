import { NotFoundException } from '@nestjs/common';
import VacationType from '@common/enums/vacation-type.enum';
import { DAY_MS } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { leaveFileLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { LeaveFileUploadsRepository } from 'src/leave-file/repositories/leave-file-uploads.repository';
import { LeaveFileUndoService } from 'src/leave-file/services/leave-file-undo.service';
import { ILeaveFileUndo } from 'src/leave-file/types/leave-file-undo.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';

const UPLOAD_ID = '3b9c3c52-6a43-4a0e-9a8c-1f3f6d6f5a11';
const hr = { id: 'hr', slack_team_id: 'ws' } as IUserViewModel;

const person = (id: string, fields: Partial<IUserViewModel> = {}) =>
  ({
    id,
    name: `Name ${id}`,
    email: `${id}@x.test`,
    ...fields,
  }) as IUserViewModel;

const anna = person('anna', { name: 'Anna Novak' });
const ben = person('ben', { name: '', email: 'ben@x.test' });

const historyUndo: ILeaveFileUndo = {
  kind: LeaveFileKind.History,
  requests: [
    { id: 'r1', updatedAt: '2026-06-17T09:00:00.000001+00:00' },
    { id: 'r2', updatedAt: '2026-06-17T09:00:00.000002+00:00' },
    { id: 'r3', updatedAt: '2026-06-17T09:00:00.000003+00:00' },
  ],
};

const balance = { balance_on: '2026-01-01' } as never;
const balancesUndo: ILeaveFileUndo = {
  kind: LeaveFileKind.Balances,
  balances: [
    { userId: 'anna', before: balance, updatedAt: 't1' },
    { userId: 'ben', before: null, updatedAt: 't2' },
  ],
  contractStarts: [
    { userId: 'anna', before: '2025-01-01', after: '2026-02-02' },
    { userId: 'ben', before: null, after: '2026-03-03' },
  ],
};

describe('LeaveFileUndoService', () => {
  const build = (
    undo: ILeaveFileUndo,
    {
      upload = {},
      deleted = [] as string[],
      stillThere = [] as {
        id: string;
        user_id: string;
        type: VacationType;
        start_date: string;
        end_date: string;
      }[],
      balancesRestored = [] as string[],
      startsRestored = [] as string[],
    } = {},
  ) => {
    const stored = {
      id: UPLOAD_ID,
      slack_team_id: 'ws',
      kind: undo.kind,
      status: LeaveFileUploadStatus.Applied,
      applied_at: new Date().toISOString(),
      undo,
      ...upload,
    } as ILeaveFileUpload;
    const repository = {
      findOne: jest.fn().mockResolvedValue(stored),
      markUndone: jest
        .fn()
        .mockResolvedValue({ ...stored, status: LeaveFileUploadStatus.Undone }),
    };
    const usersService = {
      findMany: jest.fn().mockResolvedValue([anna, ben]),
      restoreContractStartDates: jest.fn().mockResolvedValue(startsRestored),
    };
    const vacationRequestsService = {
      deleteImported: jest.fn().mockResolvedValue(deleted),
      findMany: jest.fn().mockResolvedValue(stillThere),
    };
    const leaveBalancesService = {
      restoreMany: jest.fn().mockResolvedValue(balancesRestored),
    };
    const transactions = {
      transaction: jest.fn((work: () => Promise<unknown>) => work()),
      lock: jest.fn(),
    };
    const service = new LeaveFileUndoService(
      repository as unknown as LeaveFileUploadsRepository,
      usersService as unknown as UsersService,
      vacationRequestsService as unknown as VacationRequestsService,
      leaveBalancesService as unknown as LeaveBalancesService,
      transactions as unknown as TransactionService,
    );

    return {
      service,
      stored,
      repository,
      usersService,
      vacationRequestsService,
      leaveBalancesService,
      transactions,
    };
  };

  it('takes the workspace lock and finds the upload only in the clicker’s workspace', async () => {
    const { service, repository, transactions } = build(historyUndo);

    await service.undo(UPLOAD_ID, hr);

    expect(transactions.lock).toHaveBeenCalledWith(leaveFileLock('ws'));
    expect(repository.findOne).toHaveBeenCalledWith({
      id: UPLOAD_ID,
      slack_team_id: 'ws',
    });
  });

  it.each(['not-an-id', ''])('treats %j as no upload', async (id) => {
    const { service, transactions } = build(historyUndo);

    await expect(service.undo(id, hr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(transactions.transaction).not.toHaveBeenCalled();
  });

  it('treats an upload of no workspace of the clicker as none', async () => {
    const { service, repository } = build(historyUndo);

    repository.findOne.mockResolvedValue(null);

    await expect(service.undo(UPLOAD_ID, hr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it.each([
    LeaveFileUploadStatus.Previewed,
    LeaveFileUploadStatus.Canceled,
    LeaveFileUploadStatus.Superseded,
  ])('treats an upload that is %s as none', async (status) => {
    const { service } = build(historyUndo, { upload: { status } });

    await expect(service.undo(UPLOAD_ID, hr)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('closes an upload that was already undone, changing nothing', async () => {
    const { service, vacationRequestsService, repository } = build(
      historyUndo,
      { upload: { status: LeaveFileUploadStatus.Undone } },
    );

    await expect(service.undo(UPLOAD_ID, hr)).resolves.toEqual({
      kind: 'closed',
      reason: 'it was already undone',
    });
    expect(vacationRequestsService.deleteImported).not.toHaveBeenCalled();
    expect(repository.markUndone).not.toHaveBeenCalled();
  });

  it('closes an upload applied more than 7 days ago, but not one applied just inside the window', async () => {
    const old = build(historyUndo, {
      upload: {
        applied_at: new Date(Date.now() - 7 * DAY_MS - 60_000).toISOString(),
      },
    });

    await expect(old.service.undo(UPLOAD_ID, hr)).resolves.toEqual({
      kind: 'closed',
      reason: "it's been more than 7 days",
    });
    expect(old.vacationRequestsService.deleteImported).not.toHaveBeenCalled();

    const recent = build(historyUndo, {
      upload: {
        applied_at: new Date(Date.now() - 7 * DAY_MS + 60_000).toISOString(),
      },
    });

    await expect(recent.service.undo(UPLOAD_ID, hr)).resolves.toMatchObject({
      kind: 'undone',
    });
  });

  it('undoes an older upload although a newer one was applied since', async () => {
    const { service, repository } = build(historyUndo);

    await expect(service.undo(UPLOAD_ID, hr)).resolves.toMatchObject({
      kind: 'undone',
    });
    expect(repository.markUndone).toHaveBeenCalledWith(UPLOAD_ID, 'ws');
  });

  describe('a history upload', () => {
    it('deletes the leaves still as the upload left them and counts them', async () => {
      const { service, vacationRequestsService, stored } = build(historyUndo, {
        deleted: ['r1', 'r2', 'r3'],
      });

      await expect(service.undo(UPLOAD_ID, hr)).resolves.toEqual({
        kind: 'undone',
        restored: 3,
        kept: [],
        upload: { ...stored, status: LeaveFileUploadStatus.Undone },
      });
      expect(vacationRequestsService.deleteImported).toHaveBeenCalledWith(
        historyUndo.kind === LeaveFileKind.History ? historyUndo.requests : [],
        UPLOAD_ID,
        'ws',
      );
    });

    it('keeps and names a leave that is still there but changed, and ignores one deleted since', async () => {
      const { service, vacationRequestsService } = build(historyUndo, {
        deleted: ['r1'],
        stillThere: [
          {
            id: 'r2',
            user_id: 'anna',
            type: VacationType.AnnualLeave,
            start_date: '2026-05-04',
            end_date: '2026-05-15',
          },
          {
            id: 'r3',
            user_id: 'ben',
            type: VacationType.SickLeave,
            start_date: '2026-06-01',
            end_date: '2026-06-01',
          },
        ],
      });

      await expect(service.undo(UPLOAD_ID, hr)).resolves.toMatchObject({
        kind: 'undone',
        restored: 1,
        kept: [
          "Anna Novak's annual leave 4–15 May 2026",
          "ben@x.test's sick leave 1 Jun 2026",
        ],
      });
      expect(vacationRequestsService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'ws',
        ids: ['r2', 'r3'],
      });
    });

    it('reads nothing more when everything was deleted', async () => {
      const { service, vacationRequestsService } = build(historyUndo, {
        deleted: ['r1', 'r2', 'r3'],
      });

      await service.undo(UPLOAD_ID, hr);

      expect(vacationRequestsService.findMany).not.toHaveBeenCalled();
    });
  });

  describe('a balances upload', () => {
    it('puts back the balances and contract starts as the upload left them', async () => {
      const { service, leaveBalancesService, usersService } = build(
        balancesUndo,
        { balancesRestored: ['anna', 'ben'], startsRestored: ['anna', 'ben'] },
      );

      await expect(service.undo(UPLOAD_ID, hr)).resolves.toMatchObject({
        kind: 'undone',
        restored: 4,
        kept: [],
      });
      expect(leaveBalancesService.restoreMany).toHaveBeenCalledWith(
        [
          {
            userId: 'anna',
            uploadId: UPLOAD_ID,
            updatedAt: 't1',
            before: balance,
          },
          { userId: 'ben', uploadId: UPLOAD_ID, updatedAt: 't2', before: null },
        ],
        'ws',
      );
      expect(usersService.restoreContractStartDates).toHaveBeenCalledWith(
        [
          { userId: 'anna', expected: '2026-02-02', before: '2025-01-01' },
          { userId: 'ben', expected: '2026-03-03', before: null },
        ],
        hr,
      );
    });

    it('keeps and names what changed since', async () => {
      const { service } = build(balancesUndo, {
        balancesRestored: ['ben'],
        startsRestored: ['anna'],
      });

      await expect(service.undo(UPLOAD_ID, hr)).resolves.toMatchObject({
        restored: 2,
        kept: ["Anna Novak's balance", "ben@x.test's contract start"],
      });
    });

    it('does not call the writes for nothing', async () => {
      const { service, leaveBalancesService, usersService } = build({
        kind: LeaveFileKind.Balances,
        balances: [],
        contractStarts: [],
      });

      await service.undo(UPLOAD_ID, hr);

      expect(leaveBalancesService.restoreMany).not.toHaveBeenCalled();
      expect(usersService.restoreContractStartDates).not.toHaveBeenCalled();
    });
  });

  it('marks the upload undone only after restoring', async () => {
    const order: string[] = [];
    const { service, vacationRequestsService, repository } = build(historyUndo);

    vacationRequestsService.deleteImported.mockImplementation(async () => {
      order.push('delete');
      return [];
    });
    repository.markUndone.mockImplementation(async () => {
      order.push('mark');
      return {};
    });

    await service.undo(UPLOAD_ID, hr);

    expect(order).toEqual(['delete', 'mark']);
  });
});
