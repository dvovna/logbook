import { Injectable, NotFoundException } from '@nestjs/common';
import { DAY_MS, formatDateRange } from '@common/utils/date.utils';
import { TransactionService } from 'src/database/transaction.service';
import { leaveFileLock } from 'src/database/advisory-locks';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { LEAVE_FILE_UNDO_DAYS } from 'src/leave-file/constants/leave-file-limits';
import { LEAVE_FILE_TYPE_NAMES } from 'src/leave-file/constants/leave-file-type-names';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { LeaveFileUploadsRepository } from 'src/leave-file/repositories/leave-file-uploads.repository';
import { ILeaveFileUndo } from 'src/leave-file/types/leave-file-undo.interface';
import { ILeaveFileUndoResult } from 'src/leave-file/types/leave-file-undo-result.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';
import { UPLOAD_ID_PATTERN } from 'src/team-file/constants/team-file-upload-id';

const NOT_OPEN = 'This preview is no longer open.';

@Injectable()
export class LeaveFileUndoService {
  public constructor(
    private readonly uploadsRepository: LeaveFileUploadsRepository,
    private readonly usersService: UsersService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly transactions: TransactionService,
  ) {}

  // Puts back what Apply changed, wherever it is still as Apply left it, and
  // says what it left. Any applied upload of the workspace within 7 days may
  // be undone, not only the latest. The ID comes from a button value: only an
  // upload of the user's workspace is found. Under Apply's lock, so two
  // clicks undo once. Each value goes back through a write that holds only
  // while the value is still the one Apply left.
  public async undo(
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileUndoResult> {
    const slackTeamId = user.slack_team_id;

    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new NotFoundException(NOT_OPEN);
    }

    return this.transactions.transaction(async () => {
      await this.transactions.lock(leaveFileLock(slackTeamId));

      const upload = await this.uploadsRepository.findOne({
        id: uploadId,
        slack_team_id: slackTeamId,
      });

      if (!upload) {
        throw new NotFoundException(NOT_OPEN);
      }

      const reason = this.closedReason(upload);

      if (reason) {
        return { kind: 'closed', reason };
      }

      const { restored, kept } = await this.restore(
        upload.undo!,
        upload.id,
        user,
      );
      const undone = await this.uploadsRepository.markUndone(
        upload.id,
        slackTeamId,
      );

      return { kind: 'undone', restored, kept, upload: undone };
    });
  }

  private closedReason(upload: ILeaveFileUpload) {
    if (upload.status === LeaveFileUploadStatus.Undone) {
      return 'it was already undone';
    }

    if (upload.status !== LeaveFileUploadStatus.Applied || !upload.undo) {
      throw new NotFoundException(NOT_OPEN);
    }

    if (
      Date.now() - Date.parse(upload.applied_at!) >
      LEAVE_FILE_UNDO_DAYS * DAY_MS
    ) {
      return `it's been more than ${LEAVE_FILE_UNDO_DAYS} days`;
    }

    return null;
  }

  private async restore(
    undo: ILeaveFileUndo,
    uploadId: string,
    user: IUserViewModel,
  ) {
    const people = await this.usersService.findMany({
      slackTeamId: user.slack_team_id,
      includeInactive: true,
    });
    const nameOf = (id: string) => {
      const person = people.find((p) => p.id === id);

      return person ? person.name || person.email : 'Someone';
    };

    return undo.kind === LeaveFileKind.History
      ? this.restoreHistory(undo, uploadId, user, nameOf)
      : this.restoreBalances(undo, uploadId, user, nameOf);
  }

  // A leave deleted since is neither restored nor kept: only one still
  // there, and so changed, is named.
  private async restoreHistory(
    undo: Extract<ILeaveFileUndo, { kind: LeaveFileKind.History }>,
    uploadId: string,
    user: IUserViewModel,
    nameOf: (id: string) => string,
  ) {
    const slackTeamId = user.slack_team_id;
    const deleted = new Set(
      await this.vacationRequestsService.deleteImported(
        undo.requests,
        uploadId,
        slackTeamId,
      ),
    );
    const left = undo.requests.filter(({ id }) => !deleted.has(id));
    const changed = left.length
      ? await this.vacationRequestsService.findMany({
          slackTeamId,
          ids: left.map(({ id }) => id),
        })
      : [];

    return {
      restored: deleted.size,
      kept: changed.map(
        (leave) =>
          `${nameOf(leave.user_id)}'s ${LEAVE_FILE_TYPE_NAMES[
            leave.type
          ].toLowerCase()} ${formatDateRange(leave.start_date, leave.end_date)}`,
      ),
    };
  }

  private async restoreBalances(
    undo: Extract<ILeaveFileUndo, { kind: LeaveFileKind.Balances }>,
    uploadId: string,
    user: IUserViewModel,
    nameOf: (id: string) => string,
  ) {
    const [balancesBack, startsBack] = [
      new Set(
        undo.balances.length
          ? await this.leaveBalancesService.restoreMany(
              undo.balances.map(({ userId, updatedAt, before }) => ({
                userId,
                uploadId,
                updatedAt,
                before,
              })),
              user.slack_team_id,
            )
          : [],
      ),
      new Set(
        undo.contractStarts.length
          ? await this.usersService.restoreContractStartDates(
              undo.contractStarts.map(({ userId, after, before }) => ({
                userId,
                expected: after,
                before,
              })),
              user,
            )
          : [],
      ),
    ];

    return {
      restored: balancesBack.size + startsBack.size,
      kept: [
        ...undo.balances
          .filter(({ userId }) => !balancesBack.has(userId))
          .map(({ userId }) => `${nameOf(userId)}'s balance`),
        ...undo.contractStarts
          .filter(({ userId }) => !startsBack.has(userId))
          .map(({ userId }) => `${nameOf(userId)}'s contract start`),
      ],
    };
  }
}
