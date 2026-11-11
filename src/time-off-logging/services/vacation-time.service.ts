import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import {
  IRemovedVacationTime,
  IVacationTimeParams,
} from 'src/time-off-logging/types/vacation-time.types';

// The time entries logged from an approved vacation, linked to it by
// `vacation_request_id`.
@Injectable()
export class VacationTimeService {
  public constructor(
    private readonly projectsService: ProjectsService,
    private readonly timeEntryWriter: TimeEntryWriter,
  ) {}

  // `minutes` on each of `dates`, approved, in one insert. The caller has
  // checked the person, the days and the project (no owner or assignment
  // check, which are for people logging their own time), and takes care that
  // no day gets two sets. Returns how many entries.
  public async log({
    userId,
    teamId,
    projectId,
    minutes,
    dates,
    vacationRequestId,
    description,
    slackTeamId,
  }: IVacationTimeParams): Promise<number> {
    if (!dates.length) {
      return 0;
    }

    const project = await this.projectsService.findOne({
      id: projectId,
      slackTeamId,
    });

    if (!project) {
      throw new ValidationError('Project not found');
    }

    const created = await this.timeEntryWriter.insertMany(
      dates.map((date) => ({
        params: {
          userId,
          teamId,
          projectId,
          workDate: new Date(date),
          minutes,
          description,
          status: TimeEntryStatus.Approved,
        },
        project,
        vacationRequestId,
      })),
      { id: userId, slack_team_id: slackTeamId },
    );

    return created.length;
  }

  // Deletes the vacation's time (keeping it as history) when the vacation
  // changes or goes, in the caller's transaction, in one statement. Entries
  // in a billing snapshot can't change and stay; their days are returned,
  // sorted, so the person who changed the vacation hears of them.
  public async remove(
    requestId: string,
    slackTeamId: string,
    user: IUserViewModel,
  ): Promise<IRemovedVacationTime> {
    const { deleted, billedDates } =
      await this.timeEntryWriter.deleteLinkedToVacation(
        requestId,
        slackTeamId,
        user.id,
      );

    const owners = new Map<string, { minutes: number; projectIds: string[] }>();

    for (const { user_id, minutes, project_id } of deleted) {
      const owner = owners.get(user_id) ?? { minutes: 0, projectIds: [] };

      owners.set(user_id, {
        minutes: owner.minutes + minutes,
        projectIds: [...new Set([...owner.projectIds, project_id])],
      });
    }

    return {
      deleted: deleted.length,
      owners: [...owners].map(([userId, owner]) => ({ userId, ...owner })),
      billedDates: [...new Set(billedDates.map(getDateOnly))].sort(),
    };
  }
}
