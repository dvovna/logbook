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
import { BlockSuggestion } from '@slack/bolt/dist/types/options';
import { SlackSignatureGuard } from '@common/guards/slack-signature.guard';
import { SlackUserGuard } from '@common/guards/slack-user.guard';
import { SlackActiveUserGuard } from '@common/guards/slack-active-user.guard';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ProjectAssignmentModalViewActionId } from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { ProjectOptionsService } from '@modules/slack/services/option-services/project-options.service';
import { UserOptionsService } from '@modules/slack/services/option-services/user-options.service';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

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
      case VacationRequestsTabViewActionId.UserField:
      case UsersTabViewActionId.FilterUsersByUser:
      case TimeEntriesTabViewActionId.SelectUser:
      case TimeEntriesTabViewActionId.FilterByUser:
      case VacationRequestsTabViewActionId.FilterRequestsByUser: {
        return this.userOptionsService.searchUsers({
          query: payload.value,
          user: request.user!,
          includeInactive: true,
        });
      }
      case ProjectAssignmentModalViewActionId.ProjectUsers: {
        return this.userOptionsService.searchUsers({
          query: payload.value,
          user: request.user!,
          includeInactive: false,
        });
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
