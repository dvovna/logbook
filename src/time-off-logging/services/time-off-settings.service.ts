import { ForbiddenException, Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import ProjectsService from 'src/projects/services/projects.service';
import { TransactionService } from 'src/database/transaction.service';
import { TimeOffProjectsRepository } from 'src/time-off-logging/repositories/time-off-projects.repository';
import { ITimeOffSettings } from 'src/time-off-logging/types/time-off-settings.types';
import { isTimeOffLeaveType } from 'src/time-off-logging/constants/time-off-leave-types';

const MINUTES_IN_DAY = 24 * 60;

// What time off is logged as: the hours of a working day and the project of
// each leave type.
@Injectable()
export class TimeOffSettingsService {
  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly projectsService: ProjectsService,
    private readonly timeOffProjectsRepository: TimeOffProjectsRepository,
    private readonly transactions: TransactionService,
  ) {}

  // A project archived since it was chosen is still here; whoever logs time
  // off checks that it takes time.
  public async get(slackTeamId: string): Promise<ITimeOffSettings> {
    const [minutesPerDay, rows] = await Promise.all([
      this.slackTeamsService.getTimeOffMinutesPerDay(slackTeamId),
      this.timeOffProjectsRepository.findMany({ slack_team_id: slackTeamId }),
    ]);
    const projectIds: ITimeOffSettings['projectIds'] = {};

    for (const { vacation_type, project_id } of rows) {
      projectIds[vacation_type as VacationType] = project_id;
    }

    return { minutesPerDay, projectIds };
  }

  // An admin's. The projects become exactly the ones given, in one
  // transaction. The IDs come from a form, so each has to be an active
  // project of the workspace; the error names its leave type.
  public async set(
    user: IUserViewModel,
    { minutesPerDay, projectIds }: ITimeOffSettings,
  ): Promise<void> {
    if (user.role !== UserRole.Admin) {
      throw new ForbiddenException('Only an admin sets what time off is.');
    }

    if (
      !Number.isInteger(minutesPerDay) ||
      minutesPerDay <= 0 ||
      minutesPerDay > MINUTES_IN_DAY ||
      minutesPerDay % 15 !== 0
    ) {
      throw new ValidationError(
        'A day is 15 minutes to 24 hours, in 15-minute steps.',
        'hours',
      );
    }

    const slackTeamId = user.slack_team_id;
    const chosen = Object.entries(projectIds).filter(
      (entry): entry is [VacationType, string] => Boolean(entry[1]),
    );

    for (const [type] of chosen) {
      if (!isTimeOffLeaveType(type)) {
        throw new ValidationError('This leave type has no project.', type);
      }
    }

    const projects = chosen.length
      ? await this.projectsService.findMany({
          ids: chosen.map(([, projectId]) => projectId),
          slackTeamId,
        })
      : [];
    const activeIds = new Set(projects.map(({ id }) => id));

    for (const [type, projectId] of chosen) {
      if (!activeIds.has(projectId)) {
        throw new ValidationError(
          'This project is not in this workspace or is archived.',
          type,
        );
      }
    }

    await this.transactions.transaction(async () => {
      await this.slackTeamsService.setTimeOffMinutesPerDay(
        slackTeamId,
        minutesPerDay,
      );
      await this.timeOffProjectsRepository.deleteMany({
        slack_team_id: slackTeamId,
      });
      await this.timeOffProjectsRepository.createMany(
        chosen.map(([vacation_type, project_id]) => ({
          slack_team_id: slackTeamId,
          vacation_type,
          project_id,
        })),
      );
    });
  }
}
