import { ForbiddenException, Injectable } from '@nestjs/common';
import { IOpenModalBaseParams } from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ClientsService from '@modules/clients/services/clients.service';
import { GetUserProjectsQuery, IUserProject } from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

export interface ITimeEntryModalViewParams
  extends IOpenModalBaseParams {
  timeEntryId?: string;
  pageMetadata?: string;
}

@Injectable()
export class TimeEntryModalService {
  public constructor(
    private readonly timeEntryFormModalView: TimeEntryFormModalView,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
    private readonly projectsService: ProjectsService,
    private readonly clientsService: ClientsService,
    private readonly timeEntriesService: TimeEntriesService,
  ) {}

  public async getModal({
    timeEntryId,
    user,
    errorMessage,
    pageMetadata = '',
  }: ITimeEntryModalViewParams): Promise<View> {
    const [projects, timeEntry] = await Promise.all([
      this.getProjects(user),
      timeEntryId
        ? this.timeEntriesService.findOneWithValidation({
          id: timeEntryId,
          slackTeamId: user.slack_team_id,
        })
        : undefined,
    ]);

    // The ID comes from the client: only Admin and HR open others' entries.
    if (
      timeEntry &&
      timeEntry.user_id !== user.id &&
      !isTimeEntriesAdmin(user.role)
    ) {
      throw new ForbiddenException('You cannot edit this time entry.');
    }

    return this.timeEntryFormModalView.getView(
      {
        initialData: timeEntry,
        userProjects: projects,
        callbackId: isTimeEntriesAdmin(user.role)
          ? ViewCallbackId.AdminTimeEntry
          : ViewCallbackId.UserTimeEntry,
        errorMessage,
        user,
      },
      {
        pageMetadata,
        id: timeEntryId,
      },
    );
  }

  // Admin and HR log time for anyone, so on any active project; everyone
  // else on the projects of their team and their own ones.
  private async getProjects(user: IUserViewModel): Promise<IUserProject[]> {
    if (!isTimeEntriesAdmin(user.role)) {
      return this.getUserProjectsQuery.execute({
        userId: user.id,
        slackTeamId: user.slack_team_id,
      });
    }

    const [projects, clients] = await Promise.all([
      this.projectsService.findMany({ slackTeamId: user.slack_team_id }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
    ]);
    const clientNames = new Map(
      clients.map((client) => [client.id, client.name]),
    );

    // The order of get_user_projects: by client, projects without one last.
    return projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        clientId: project.client_id ?? '',
        clientName: (project.client_id && clientNames.get(project.client_id)) || '',
      }))
      .sort(
        (a, b) =>
          Number(!a.clientName) - Number(!b.clientName) ||
          a.clientName.localeCompare(b.clientName) ||
          a.name.localeCompare(b.name),
      );
  }
}
