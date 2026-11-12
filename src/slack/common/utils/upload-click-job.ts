import { Logger } from '@nestjs/common';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';

// A click on Apply or Undo of a shared file: the upload its button names
// and, for Apply, the digest of the plan shown.
export interface IUploadClickJob {
  uploadId: string;
  digest?: string;
  userId: string;
  slackTeamId: string;
}

// Applying or undoing a file is one transaction of many statements, made
// after the click's answer. As a job saved before that answer (enqueue), a
// click whose process stopped before or halfway through it (a deploy) is
// done by the next one instead of being lost with a message that still
// shows its button: the transaction rolled back, and the upload is as the
// click found it. Only that is retried. A failure while the
// process lives was told to the person, who may click again or not: applying
// it minutes later behind their back would surprise them, so it ends the
// job. A run after the click was done finds the upload closed and does
// nothing.
export const defineUploadClickJob = (
  {
    jobs,
    usersService,
    logger,
  }: { jobs: JobsService; usersService: UsersService; logger: Logger },
  name: string,
  task: string,
  work: (job: IUploadClickJob, user: IUserViewModel) => Promise<unknown>,
) =>
  jobs.define<IUploadClickJob>(name, async (job) => {
    const user = await usersService.findOne({
      id: job.userId,
      slackTeamId: job.slackTeamId,
    });

    // Deactivated or without the role since the click.
    if (!user || !ADMIN_AND_HR_ROLES.includes(user.role)) {
      return;
    }

    try {
      await work(job, user);
    } catch (error) {
      logger.error(
        `Failed to ${task}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      reportError(error, { task });
    }
  });

export const uploadClickJobOf = (
  user: IUserViewModel,
  uploadId: string,
  digest?: string,
): IUploadClickJob => ({
  uploadId,
  ...(digest === undefined ? {} : { digest }),
  userId: user.id,
  slackTeamId: user.slack_team_id,
});
