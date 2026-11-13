import { Injectable } from '@nestjs/common';
import ProjectsService from 'src/projects/services/projects.service';

// Whether people can log time at all: the workspace has a project, archived
// ones too (time logged on them is still the person's). Without one,
// navigation leaves out the screens about time and Home its time section.
@Injectable()
export class TimeTrackingUseService {
  public constructor(private readonly projectsService: ProjectsService) {}

  public async tracksTime(slackTeamId: string): Promise<boolean> {
    return (
      (await this.projectsService.count({
        slackTeamId,
        includeArchived: true,
      })) > 0
    );
  }
}
