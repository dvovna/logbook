import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import UserRole from '@common/enums/user-role.enum';
import { DAY_MS } from '@common/utils/date.utils';
import { TransactionService } from 'src/database/transaction.service';
import { teamFileLock } from 'src/database/advisory-locks';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { UPLOAD_ID_PATTERN } from 'src/team-file/constants/team-file-upload-id';
import { TEAM_FILE_PREVIEW_DAYS } from 'src/team-file/constants/team-file-limits';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import {
  planChangesNothing,
  planDigest,
  planTeamFile,
} from 'src/team-file/services/team-file-planner';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { ITeamFileApplyResult } from 'src/team-file/types/team-file-apply-result.interface';
import { TeamFileUndoService } from 'src/team-file/services/team-file-undo.service';
import { ITeamFileUndoResult } from 'src/team-file/types/team-file-undo-result.interface';
import { ITeamFileUndo } from 'src/team-file/types/team-file-undo.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

@Injectable()
export class TeamFileUploadsService {
  public constructor(
    private readonly uploadsRepository: TeamFileUploadsRepository,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
    private readonly undoService: TeamFileUndoService,
  ) {}

  // Plans the rows against the workspace as it is now and keeps them for
  // Apply, which plans again from them. A newer file replaces the open preview.
  public async receive(
    rows: ITeamFileRow[],
    fileName: string,
    user: IUserViewModel,
  ): Promise<{
    upload: ITeamFileUpload;
    plan: ITeamFilePlan;
    state: ITeamFileState;
  }> {
    const slackTeamId = user.slack_team_id;
    const state = await this.readState(slackTeamId);
    const plan = this.plan(rows, state);

    const upload = await this.transactions.transaction(async () => {
      await this.transactions.lock(teamFileLock(slackTeamId));
      await this.uploadsRepository.supersedePreviewed(slackTeamId);

      return this.uploadsRepository.create({
        slack_team_id: slackTeamId,
        uploaded_by: user.id,
        file_name: fileName,
        rows: JSON.stringify(rows),
        plan_digest: planDigest(plan),
        status: TeamFileUploadStatus.Previewed,
        // The app's clock, which Apply's 7 days are counted on.
        created_at: new Date().toISOString(),
      });
    });

    return { upload, plan, state };
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
  ): Promise<ITeamFileUpload> {
    const upload = UPLOAD_ID_PATTERN.test(uploadId)
      ? await this.uploadsRepository.cancelPreviewed(
          uploadId,
          user.slack_team_id,
        )
      : null;

    if (!upload) {
      throw new NotFoundException('This preview is no longer open.');
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
  ): Promise<ITeamFileApplyResult> {
    const slackTeamId = user.slack_team_id;

    if (!UPLOAD_ID_PATTERN.test(uploadId)) {
      throw new NotFoundException('This preview is no longer open.');
    }

    return this.transactions.transaction(async () => {
      // receive takes it too, so a newer file can't supersede this one
      // halfway, and two clicks apply once.
      await this.transactions.lock(teamFileLock(slackTeamId));

      const upload = await this.uploadsRepository.findOne({
        id: uploadId,
        slack_team_id: slackTeamId,
      });

      if (!upload) {
        throw new NotFoundException('This preview is no longer open.');
      }

      if (upload.status !== TeamFileUploadStatus.Previewed) {
        return { kind: 'closed', status: upload.status, upload };
      }

      if (
        Date.now() - Date.parse(upload.created_at) >
        TEAM_FILE_PREVIEW_DAYS * DAY_MS
      ) {
        return { kind: 'closed', status: 'expired', upload };
      }

      const state = await this.readState(slackTeamId);
      const plan = this.plan(upload.rows, state);
      const digest = planDigest(plan);

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
          plan,
          state,
          upload: { ...upload, plan_digest: digest },
        };
      }

      // An applied upload is what Undo works on, so one that changed nothing
      // must not hide the Apply before it.
      if (planChangesNothing(plan)) {
        return { kind: 'nothing', plan, state, upload };
      }

      const undo = await this.applyPlan(plan, state, user);
      const applied = await this.uploadsRepository.markApplied(
        upload.id,
        slackTeamId,
        undo,
      );

      return { kind: 'applied', plan, state, upload: applied };
    });
  }

  // The workspace's open preview (a newer file supersedes the one before, so
  // there is one at most), planned again from its rows; null when none is
  // open.
  public async previewed(slackTeamId: string): Promise<{
    upload: ITeamFileUpload;
    plan: ITeamFilePlan;
    state: ITeamFileState;
  } | null> {
    const upload = await this.uploadsRepository.findOne({
      slack_team_id: slackTeamId,
      status: TeamFileUploadStatus.Previewed,
    });

    if (
      !upload ||
      Date.now() - Date.parse(upload.created_at) >
        TEAM_FILE_PREVIEW_DAYS * DAY_MS
    ) {
      return null;
    }

    const state = await this.readState(slackTeamId);

    return { upload, plan: this.plan(upload.rows, state), state };
  }

  public undo(
    uploadId: string,
    user: IUserViewModel,
  ): Promise<ITeamFileUndoResult> {
    return this.undoService.undo(uploadId, user);
  }

  private async readState(slackTeamId: string): Promise<ITeamFileState> {
    const [people, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId, includeInactive: true }),
      this.teamsService.findMany({ slackTeamId }),
    ]);

    return { people, teams };
  }

  private plan(rows: ITeamFileRow[], state: ITeamFileState) {
    return planTeamFile(
      rows,
      state,
      this.config.getOrThrow<number>(EnvironmentVariable.MaxTeamsPerSlackTeam),
    );
  }

  private async applyPlan(
    plan: ITeamFilePlan,
    state: ITeamFileState,
    user: IUserViewModel,
  ): Promise<ITeamFileUndo> {
    const slackIds = new Map(state.people.map((p) => [p.id, p.slack_id]));
    const createdTeamIds = await this.createTeams(plan, slackIds, user);
    const assignments = plan.assignments.map((a) => ({
      userId: a.userId,
      before: a.fromTeamId,
      after: a.toTeamKey ? createdTeamIds.get(a.toTeamKey)! : a.toTeamId,
    }));

    await this.usersService.assignTeams(
      assignments.map(({ userId, after }) => ({ userId, teamId: after })),
      user,
    );
    const approvers = await this.changeLeads(plan, state, slackIds, user);
    const promoted = await this.usersService.makeManagers(
      plan.promotions,
      user,
    );

    return {
      createdTeamIds: [...createdTeamIds.values()],
      assignments,
      approvers,
      promotions: promoted.map(({ id }) => ({
        userId: id,
        before: UserRole.Member,
      })),
    };
  }

  // A new team follows the company rules, and its leads approve first, any
  // one of them (D1). The new team's ID by its key in the plan.
  private async createTeams(
    plan: ITeamFilePlan,
    slackIds: Map<string, string>,
    user: IUserViewModel,
  ) {
    const ids = new Map<string, string>();

    for (const team of plan.createTeams) {
      const { id } = await this.teamsService.create(
        {
          name: team.name,
          slackTeamId: user.slack_team_id,
          followsCompanyRules: true,
          managerApprovers: team.leadIds.map((id) => slackIds.get(id)!),
          managerApproversRule: ApprovalRule.Any,
        },
        user,
      );

      ids.set(team.key, id);
    }

    return ids;
  }

  // Approvers who are no person of the workspace, or not in the file, stay
  // as they are (D3): the plan names only the leads to add and remove.
  private async changeLeads(
    plan: ITeamFilePlan,
    state: ITeamFileState,
    slackIds: Map<string, string>,
    user: IUserViewModel,
  ): Promise<ITeamFileUndo['approvers']> {
    const teams = new Map(state.teams.map((team) => [team.id, team]));
    const changes: ITeamFileUndo['approvers'] = [];

    for (const { teamId, add, remove } of plan.leadChanges) {
      const before = teams.get(teamId)?.manager_approvers ?? [];
      const removed = new Set(remove.map((id) => slackIds.get(id)));
      const kept = before.filter((slackId) => !removed.has(slackId));
      const after = [
        ...kept,
        ...add.map((id) => slackIds.get(id)!).filter((s) => !kept.includes(s)),
      ];

      await this.teamsService.update(
        { id: teamId, slackTeamId: user.slack_team_id },
        { managerApprovers: after },
        user,
      );
      changes.push({ teamId, before, after });
    }

    return changes;
  }
}
