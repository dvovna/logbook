import { canSeeRates } from 'src/projects/constants/rate-roles';
import { TeamModalActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { SlackUserAccessFilter } from '@modules/slack/filters/slack-user-access.filter';
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  UseFilters,
} from '@nestjs/common';
import { Request } from 'express';
import type { BlockSuggestion } from '@slack/bolt/dist/types/options';
import { SlackSignatureGuard } from '@modules/slack/guards/slack-signature.guard';
import { SlackUserGuard } from '@modules/slack/guards/slack-user.guard';
import { SlackActiveUserGuard } from '@modules/slack/guards/slack-active-user.guard';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { PersonRateModalActionId } from '@modules/slack/tabs/projects/enums/person-rate-modal-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { ProjectOptionsService } from '@modules/slack/services/option-services/project-options.service';
import { UserOptionsService } from '@modules/slack/services/option-services/user-options.service';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

import { TimeReportFilterId } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import {
  MANAGER_ROLES,
  OTHERS_TIME_ROLES,
} from '@common/constants/role-groups';
@Controller('api/slack/options')
@UseFilters(SlackUserAccessFilter)
@UseGuards(SlackSignatureGuard, SlackUserGuard, SlackActiveUserGuard)
export class SlackOptionsController {
  public constructor(
    private readonly userOptionsService: UserOptionsService,
    private readonly projectOptionsService: ProjectOptionsService,
  ) {}

  @Post('/')
  public getOptions(@Req() request: Request, @Body() payload: BlockSuggestion) {
    const actionId = payload.action_id as unknown;

    switch (actionId) {
      // The people the viewer manages: a manager's teams on People and All
      // requests; the other selects are Admin's and HR's.
      case VacationRequestsTabViewActionId.UserField:
      case UsersTabViewActionId.FilterUsersByUser:
      case TimeEntriesTabViewActionId.SelectUser:
      case TimeEntriesTabViewActionId.FilterByUser:
      case VacationRequestsTabViewActionId.FilterRequestsByUser: {
        // Inactive people too: what they did is still in the lists.
        return this.userOptionsService.searchUsers({
          query: payload.value,
          user: request.user!,
          includeInactive: true,
        });
      }
      case PersonRateModalActionId.Person: {
        // Anyone of the workspace, for those who set rates (Admin and
        // Finance); inactive people too: their past time may still need a
        // rate.
        if (!canSeeRates(request.user!.role)) {
          return { options: [] };
        }

        return this.userOptionsService.searchUsers({
          query: payload.value,
          user: request.user!,
          includeInactive: true,
          wholeWorkspace: true,
        });
      }
      case TeamModalActionId.Members: {
        return this.userOptionsService.searchUsers({
          query: payload.value,
          user: request.user!,
          includeInactive: false,
        });
      }
      // Projects are the workspace's: a manager assigns any team or person
      // to one, as the form's teams show.
      case ProjectAssignmentModalViewActionId.ProjectUsers: {
        return MANAGER_ROLES.includes(request.user!.role)
          ? this.userOptionsService.searchUsers({
              query: payload.value,
              user: request.user!,
              includeInactive: false,
              wholeWorkspace: true,
            })
          : { options: [] };
      }
      case TimeEntriesTabViewActionId.FilterByProject: {
        const params = { query: payload.value, user: request.user! };

        return isTimeEntriesAdmin(request.user!.role)
          ? this.projectOptionsService.searchProjects({
              ...params,
              includeArchived: true,
            })
          : this.projectOptionsService.searchUserProjects(params);
      }
      // The time report's filters: projects for anyone (a member's own
      // ones), people for those who see others' time (a manager's teams).
      // The report keeps to the viewer's scope whatever they choose.
      case TimeReportFilterId.Project: {
        const params = { query: payload.value, user: request.user! };

        return OTHERS_TIME_ROLES.includes(request.user!.role)
          ? this.projectOptionsService.searchProjects({
              ...params,
              includeArchived: true,
            })
          : this.projectOptionsService.searchUserProjects(params);
      }
      case TimeReportFilterId.Person: {
        return OTHERS_TIME_ROLES.includes(request.user!.role)
          ? this.userOptionsService.searchPeopleInScope({
              query: payload.value,
              user: request.user!,
            })
          : { options: [] };
      }
      case ProjectsTabViewActionId.FindProjectByName: {
        return this.projectOptionsService.searchProjects({
          query: payload.value,
          user: request.user!,
          includeArchived: true,
        });
      }
      default: {
        return { options: [] };
      }
    }
  }
}
