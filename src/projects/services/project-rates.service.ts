import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import ProjectsService from 'src/projects/services/projects.service';
import IProjectViewModel from 'src/projects/types/project.types';
import { ProjectUserRatesRepository } from 'src/projects/repositories/project-user-rates.repository';
import {
  IPersonRate,
  IProjectRates,
  IProjectUserRateViewModel,
} from 'src/projects/types/project-user-rate.types';
import {
  assertCanSeeRates,
  assertValidHourlyRate,
} from 'src/projects/constants/rate-roles';

interface ISetPersonRateParams {
  projectId: string;
  userId: string;
  // Null removes the person's own rate: the project's rate applies again.
  hourlyRate: number | null;
  user: IUserViewModel;
}

export interface IPersonRateChange {
  project: IProjectViewModel;
  person: IUserViewModel;
  hourlyRate: number | null;
}

const byName = (a: IPersonRate, b: IPersonRate) => a.name.localeCompare(b.name);

const toPersonRate = (rate: IProjectUserRateViewModel): IPersonRate => ({
  userId: rate.user_id,
  name: rate.user?.name ?? 'Unknown user',
  hourlyRate: rate.hourly_rate,
});

// People's own hourly rates on projects, which replace the project's rate
// for their time on it. Every method checks that the user is Admin or Finance,
// and that the project and the person are the user's workspace's: their IDs
// come from forms.
@Injectable()
export class ProjectRatesService {
  public constructor(
    private readonly projectUserRatesRepository: ProjectUserRatesRepository,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
  ) {}

  // The people with their own rate on the project, by name.
  public async findPersonRates(
    projectId: string,
    user: IUserViewModel,
  ): Promise<IPersonRate[]> {
    assertCanSeeRates(user);

    const rates = await this.projectUserRatesRepository.findMany({
      slack_team_id: user.slack_team_id,
      project_id: projectId,
    });

    return rates.map(toPersonRate).sort(byName);
  }

  // Each project's rate and the people's own rates on it, by project ID.
  public async findRates(
    projectIds: string[],
    user: IUserViewModel,
  ): Promise<Map<string, IProjectRates>> {
    assertCanSeeRates(user);

    const [projects, personRates] = await Promise.all([
      this.projectsService.findMany({
        ids: projectIds,
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
      this.projectUserRatesRepository.findMany({
        slack_team_id: user.slack_team_id,
        project_id: { operator: 'in', value: projectIds },
      }),
    ]);
    const rates = new Map<string, IProjectRates>(
      projects.map(({ id, hourly_rate }) => [
        id,
        { hourlyRate: hourly_rate, personRates: [] },
      ]),
    );

    for (const rate of personRates) {
      rates.get(rate.project_id)?.personRates.push(toPersonRate(rate));
    }

    for (const { personRates: people } of rates.values()) {
      people.sort(byName);
    }

    return rates;
  }

  // Sets or removes the person's own rate on the project. The person may be
  // anyone in the workspace, inactive too: Admin and HR log time for anyone,
  // and past time still gets billed. Admin and Finance set it.
  public async setPersonRate({
    projectId,
    userId,
    hourlyRate,
    user,
  }: ISetPersonRateParams): Promise<IPersonRateChange> {
    assertCanSeeRates(user);
    assertValidHourlyRate(hourlyRate);

    const slackTeamId = user.slack_team_id;
    const [project, person] = await Promise.all([
      this.projectsService.findOne({
        id: projectId,
        slackTeamId,
        includeArchived: true,
      }),
      this.usersService.findOne({
        id: userId,
        slackTeamId,
        includeInactive: true,
      }),
    ]);

    if (!project) {
      throw new ValidationError('This project is not in this workspace.');
    }

    if (!person) {
      throw new ValidationError(
        'This person is not in this workspace.',
        'person',
      );
    }

    if (hourlyRate === null) {
      await this.projectUserRatesRepository.deleteMany({
        slack_team_id: slackTeamId,
        project_id: projectId,
        user_id: userId,
      });
    } else {
      await this.projectUserRatesRepository.setRate({
        slackTeamId,
        projectId,
        userId,
        hourlyRate,
        updatedBy: user.id,
      });
    }

    return { project, person, hourlyRate };
  }
}
