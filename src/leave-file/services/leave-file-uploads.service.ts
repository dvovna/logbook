import { Injectable, NotFoundException } from '@nestjs/common';
import { DAY_MS } from '@common/utils/date.utils';
import { digestOf } from '@common/utils/digest.utils';
import { leaveFileLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { LEAVE_FILE_PREVIEW_DAYS } from 'src/leave-file/constants/leave-file-limits';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadStatus } from 'src/leave-file/enums/leave-file-upload-status.enum';
import { LeaveFileUploadsRepository } from 'src/leave-file/repositories/leave-file-uploads.repository';
import {
  balancesPlanChangesNothing,
  planLeaveBalances,
} from 'src/leave-file/services/leave-balances-planner';
import { LeaveFileUndoService } from 'src/leave-file/services/leave-file-undo.service';
import { LeaveFileStateService } from 'src/leave-file/services/leave-file-state.service';
import {
  historyPlanChangesNothing,
  planLeaveHistory,
} from 'src/leave-file/services/leave-history-planner';
import {
  ILeaveBalancesPlan,
  IStoredLeaveBalancesState,
} from 'src/leave-file/types/leave-balances-plan.interface';
import {
  ILeaveFileApplyResult,
  ILeaveFilePreview,
} from 'src/leave-file/types/leave-file-apply-result.interface';
import { ILeaveFile } from 'src/leave-file/types/leave-file-row.interface';
import { ILeaveFileUndoResult } from 'src/leave-file/types/leave-file-undo-result.interface';
import { ILeaveFileUndo } from 'src/leave-file/types/leave-file-undo.interface';
import { ILeaveFileUpload } from 'src/leave-file/types/leave-file-upload.interface';
import {
  ILeaveHistoryPlan,
  ILeaveHistoryState,
} from 'src/leave-file/types/leave-history-plan.interface';
import { UPLOAD_ID_PATTERN } from 'src/team-file/constants/team-file-upload-id';

const NOT_OPEN = 'This preview is no longer open.';

interface IPlannedFile {
  preview: ILeaveFilePreview;
  changesNothing: boolean;
  // Makes the plan's changes, in the caller's transaction, and says what
  // they were for Undo.
  apply: (uploadId: string, user: IUserViewModel) => Promise<ILeaveFileUndo>;
}

// The stored rows are of the upload's kind.
const fileOf = (upload: ILeaveFileUpload) =>
  ({ kind: upload.kind, rows: upload.rows }) as ILeaveFile;

@Injectable()
export class LeaveFileUploadsService {
  public constructor(
    private readonly uploadsRepository: LeaveFileUploadsRepository,
    private readonly stateService: LeaveFileStateService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly leaveBalancesService: LeaveBalancesService,
    private readonly usersService: UsersService,
    private readonly transactions: TransactionService,
    private readonly undoService: LeaveFileUndoService,
  ) {}

  // Plans the file against the workspace as it is now and keeps its rows for
  // Apply, which plans again from them. A newer file of the same kind
  // replaces the open preview; one of the other kind stays open.
  public async receive(
    file: ILeaveFile,
    fileName: string,
    user: IUserViewModel,
  ): Promise<{ upload: ILeaveFileUpload; preview: ILeaveFilePreview }> {
    const slackTeamId = user.slack_team_id;
    const { preview } = await this.plan(file, slackTeamId);

    const upload = await this.transactions.transaction(async () => {
      await this.transactions.lock(leaveFileLock(slackTeamId));
      await this.uploadsRepository.supersedePreviewed(slackTeamId, file.kind);

      return this.uploadsRepository.create({
        slack_team_id: slackTeamId,
        uploaded_by: user.id,
        kind: file.kind,
        file_name: fileName,
        rows: JSON.stringify(file.rows),
        plan_digest: digestOf(preview.plan),
        status: LeaveFileUploadStatus.Previewed,
        // The app's clock, which Apply's 7 days are counted on.
        created_at: new Date().toISOString(),
      });
    });

    return { upload, preview };
  }

  public setMessage(
    uploadId: string,
    slackTeamId: string,
    channel: string,
    ts: string,
  ) {
    return this.uploadsRepository.setMessage(
      uploadId,
      slackTeamId,
      channel,
      ts,
    );
  }

  // The ID comes from a button value, so it may be anything: only an open
  // preview of the user's workspace is canceled.
  public async cancel(
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileUpload> {
    const upload = UPLOAD_ID_PATTERN.test(uploadId)
      ? await this.uploadsRepository.cancelPreviewed(
          uploadId,
          user.slack_team_id,
        )
      : null;

    if (!upload) {
      throw new NotFoundException(NOT_OPEN);
    }

    return upload;
  }

  // Does what the clicked preview showed, or nothing: the plan is made again
  // from the stored rows against the workspace as it is under the lock, and
  // a plan other than `shownDigest` names is shown as a new preview instead.
  // Both come from the button value: only an upload of the user's workspace
  // is found, and a wrong digest only shows the preview again.
  public async apply(
    uploadId: string,
    shownDigest: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileApplyResult> {
    const slackTeamId = user.slack_team_id;

    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new NotFoundException(NOT_OPEN);
    }

    return this.transactions.transaction(async () => {
      // receive takes it too, so a newer file can't supersede this one
      // halfway, and two clicks apply once.
      await this.transactions.lock(leaveFileLock(slackTeamId));

      const upload = await this.uploadsRepository.findOne({
        id: uploadId,
        slack_team_id: slackTeamId,
      });

      if (!upload) {
        throw new NotFoundException(NOT_OPEN);
      }

      if (upload.status !== LeaveFileUploadStatus.Previewed) {
        return { kind: 'closed', status: upload.status, upload };
      }

      if (
        Date.now() - Date.parse(upload.created_at) >
        LEAVE_FILE_PREVIEW_DAYS * DAY_MS
      ) {
        return { kind: 'closed', status: 'expired', upload };
      }

      const planned = await this.plan(fileOf(upload), slackTeamId);
      const { preview } = planned;
      const digest = digestOf(preview.plan);

      // Against the clicked preview, not the stored digest: a second click
      // on an old preview, or one whose new preview never reached Slack,
      // must not apply a plan nobody saw.
      if (digest !== shownDigest) {
        if (digest !== upload.plan_digest) {
          await this.uploadsRepository.setDigest(
            upload.id,
            slackTeamId,
            digest,
          );
        }

        return {
          kind: 'changed',
          preview,
          upload: { ...upload, plan_digest: digest },
        };
      }

      // An applied upload is what Undo works on, so one that changed nothing
      // must not be marked applied.
      if (planned.changesNothing) {
        return { kind: 'nothing', preview, upload };
      }

      const undo = await planned.apply(upload.id, user);
      const applied = await this.uploadsRepository.markApplied(
        upload.id,
        slackTeamId,
        undo,
      );

      return { kind: 'applied', preview, upload: applied };
    });
  }

  public undo(
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileUndoResult> {
    return this.undoService.undo(uploadId, user);
  }

  public hasApplied(slackTeamId: string): Promise<boolean> {
    return this.uploadsRepository.hasApplied(slackTeamId);
  }

  // Where an imported leave came from, for its details. An upload undone
  // since keeps when it was applied: a leave changed since stays.
  public async findImport(
    uploadId: string,
    slackTeamId: string,
  ): Promise<{
    fileName: string;
    uploadedBy: IUserViewModel | null;
    appliedAt: string;
  } | null> {
    const upload = UPLOAD_ID_PATTERN.test(uploadId)
      ? await this.uploadsRepository.findOne({
          id: uploadId,
          slack_team_id: slackTeamId,
        })
      : null;

    if (!upload?.applied_at) {
      return null;
    }

    const uploadedBy = upload.uploaded_by
      ? await this.usersService.findOne({
          id: upload.uploaded_by,
          slackTeamId,
          includeInactive: true,
        })
      : null;

    return {
      fileName: upload.file_name,
      uploadedBy,
      appliedAt: upload.applied_at,
    };
  }

  private async plan(
    file: ILeaveFile,
    slackTeamId: string,
  ): Promise<IPlannedFile> {
    if (file.kind === LeaveFileKind.Balances) {
      const state = await this.stateService.balancesState(slackTeamId);
      const plan = planLeaveBalances(file.rows, state);

      return {
        preview: { kind: file.kind, plan, people: state.people },
        changesNothing: balancesPlanChangesNothing(plan),
        apply: (uploadId, user) =>
          this.applyBalances(plan, state, uploadId, user),
      };
    }

    const state = await this.stateService.historyState(slackTeamId, file.rows);
    const plan = planLeaveHistory(file.rows, state);

    return {
      preview: { kind: file.kind, plan, people: state.people },
      changesNothing: historyPlanChangesNothing(plan),
      apply: (uploadId, user) => this.applyHistory(plan, state, uploadId, user),
    };
  }

  private async applyHistory(
    plan: ILeaveHistoryPlan,
    state: ILeaveHistoryState,
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileUndo> {
    const teamOf = new Map(
      state.people.map(({ id, team_id }) => [id, team_id]),
    );
    const requests = await this.vacationRequestsService.addImported(
      plan.add.map(({ userId, type, startDate, endDate, comment }) => ({
        userId,
        teamId: teamOf.get(userId) ?? null,
        type,
        startDate,
        endDate,
        comment,
      })),
      user,
      uploadId,
    );

    return {
      kind: LeaveFileKind.History,
      requests: requests.map(({ id, updated_at }) => ({
        id,
        updatedAt: updated_at!,
      })),
    };
  }

  private async applyBalances(
    plan: ILeaveBalancesPlan,
    state: IStoredLeaveBalancesState,
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ILeaveFileUndo> {
    const set = await this.leaveBalancesService.setMany(
      plan.balances.map(
        ({ userId, balanceOn, daysLeft, workingDaysLeft, bonusDaysLeft }) => ({
          userId,
          balanceOn,
          daysLeft,
          workingDaysLeft,
          bonusDaysLeft,
        }),
      ),
      uploadId,
      user,
    );

    await this.usersService.setContractStartDates(
      plan.contractStarts.map(({ userId, after }) => ({
        userId,
        contractStartDate: new Date(after),
      })),
      user,
    );

    return {
      kind: LeaveFileKind.Balances,
      balances: set.map(({ user_id, updated_at }) => ({
        userId: user_id,
        before: state.balanceOf.get(user_id) ?? null,
        updatedAt: updated_at,
      })),
      contractStarts: plan.contractStarts.map(({ userId, before, after }) => ({
        userId,
        before,
        after,
      })),
    };
  }
}
