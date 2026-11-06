import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { Injectable } from '@nestjs/common';
import { ISelectedOption } from '@modules/slack/common/utils/parsing-utils';
import {
  ProjectAssignmentModalViewActionId,
} from '@modules/slack/tabs/projects/enums/project-assignments-modal-action-id.enum';

export const MAX_TEAMS = 30;
export const MAX_USERS = 30;

export const projectAssignmentsFormSchema = z.object({
  [ProjectAssignmentModalViewActionId.ProjectTeams]: z
    .array(
      z.object({
        value: z.string().uuid(),
        text: z.string(),
      }),
    )
    .max(MAX_TEAMS, `You can assign up to ${MAX_TEAMS} teams only`)
    .optional(),
  [ProjectAssignmentModalViewActionId.ProjectUsers]: z
    .array(
      z.object({
        value: z.string().uuid(),
        text: z.string(),
      }),
    )
    .max(MAX_USERS, `You can assign up to ${MAX_USERS} users only`)
    .optional(),
});

export interface IProjectAssignmentsFormViewData {
  project_users?: ISelectedOption[];
  project_teams?: ISelectedOption[];
}

@Injectable()
export default class ProjectAssignmentsModalViewValuesParser extends BaseValuesParser<IProjectAssignmentsFormViewData> {
  public constructor() {
    super(projectAssignmentsFormSchema, {
      [ProjectAssignmentModalViewActionId.ProjectTeams]: {
        blockId: 'project_teams_block',
        type: ViewFieldType.MultiSelect,
      },
      [ProjectAssignmentModalViewActionId.ProjectUsers]: {
        blockId: 'project_users_block',
        type: ViewFieldType.MultiSelect,
      },
    });
  }
}
