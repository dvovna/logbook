import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from '@modules/teams/services/teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamFileUploadStatus } from 'src/team-file/enums/team-file-upload-status.enum';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import {
  planDigest,
  planTeamFile,
} from 'src/team-file/services/team-file-planner';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { ITeamFileUpload } from 'src/team-file/types/team-file-upload.interface';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class TeamFileUploadsService {
  public constructor(
    private readonly uploadsRepository: TeamFileUploadsRepository,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
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
    const [people, teams] = await Promise.all([
      this.usersService.findMany({ slackTeamId, includeInactive: true }),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const state = { people, teams };
    const plan = planTeamFile(
      rows,
      state,
      this.config.getOrThrow<number>(EnvironmentVariable.MaxTeamsPerSlackTeam),
    );

    const upload = await this.transactions.transaction(async () => {
      await this.transactions.lock(`team-file:${slackTeamId}`);
      await this.uploadsRepository.supersedePreviewed(slackTeamId);

      return this.uploadsRepository.create({
        slack_team_id: slackTeamId,
        uploaded_by: user.id,
        file_name: fileName,
        rows: JSON.stringify(rows),
        plan_digest: planDigest(plan),
        status: TeamFileUploadStatus.Previewed,
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
    const upload = UUID.test(uploadId)
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
}
