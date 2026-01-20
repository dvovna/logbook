import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { SlackMultiStaticSelectView } from '@modules/slack/common/views/components/slack-multi-static-select.view';
import { IOption } from '@modules/slack/common/types/option.interface';
import {
  ProjectAssignmentModalViewActionId,
} from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import {
  MAX_TEAMS,
  MAX_USERS,
} from '@modules/slack/tabs/projects/parsers/project-assignments-modal-view-values.parser';

interface IProjectAssignments {
  teamIds: string[];
  userIds: string[];
}

interface IGetViewParams extends IBaseModalViewParams {
  assignments: IProjectAssignments;
  teams: ITeamViewModel[];
  selectedUsers: IUserViewModel[];
}

export interface IProjectAssignmentsModalViewMetadata {
  id: string;
  pageMetadata: string;
}

@Injectable()
export class ProjectAssignmentsModalView extends BaseModalView<
  IGetViewParams,
  IProjectAssignmentsModalViewMetadata
> {
  protected callbackId = ViewCallbackId.ProjectAssignmentsFormSubmit;

  protected getTitleText(): string {
    return 'Manage Assignments';
  }

  public getViewBlocks({
    assignments,
    teams,
    selectedUsers,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const teamOptions = teams.map<IOption>(
      (client) => ({
        id: client.id,
        name: client.name,
      }),
    );
    const selectedTeamOptions = teamOptions.filter(
      (team) => assignments.teamIds.includes(team.id),
    );
    const selectedUserOptions = selectedUsers.map(
      (user) => toPlainTextOption({
        id: user.id,
        name: user.name,
      }),
    );

    return [
      ...SlackMultiStaticSelectView.getView({
        blockId: 'project_teams_block',
        actionId: ProjectAssignmentModalViewActionId.ProjectTeams,
        label: 'Project Teams',
        maxSelectedItems: MAX_TEAMS,
        emptyText: 'No teams available. Please create a team first.',
        optional: true,
        placeholder: 'Project Teams',
        options: teamOptions,
        initialValues: selectedTeamOptions.map((option) => option.id),
      }),
      {
        type: 'input',
        label: { type: 'plain_text', text: 'Project Users' },
        block_id: 'project_users_block',
        element: {
          type: 'multi_external_select',
          action_id: ProjectAssignmentModalViewActionId.ProjectUsers,
          max_selected_items: MAX_USERS,
          placeholder: {
            type: 'plain_text',
            text: 'Choose a user',
          },
          initial_options: selectedUserOptions,
          min_query_length: 2,
        },
        optional: true,
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
