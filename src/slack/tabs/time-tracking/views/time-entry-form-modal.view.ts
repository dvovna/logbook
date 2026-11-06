import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import UserRole from '@common/enums/user-role.enum';
import {
  TimeEntriesTabViewActionId,
} from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { TIME_LOG_STATUS_OPTIONS } from '@modules/slack/tabs/time-tracking/data/time-log-status.options';
import { IOption } from '@modules/slack/common/types/option.interface';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserProject } from 'src/projects/queries/get-user-projects.query';

const ADMIN_VIEW_USER_ROLES = [UserRole.Admin];

interface IGetViewParams
  extends IBaseModalViewParams<
    ViewCallbackId.UserTimeEntry | ViewCallbackId.AdminTimeEntry
  > {
  userProjects: IUserProject[];
  initialData?: ITimeEntryViewModel;
  user: IUserViewModel;
}

export interface ITimeEntryModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

@Injectable()
export class TimeEntryFormModalView extends BaseModalView<
  IGetViewParams,
  ITimeEntryModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.UserTimeEntry;

  protected getTitleText({ initialData }: IGetViewParams): string {
    return initialData ? 'Edit Time Log' : 'Log Time';
  }

  public getViewBlocks({
    initialData,
    userProjects,
    errorMessage,
    user,
  }: IGetViewParams): AnyBlock[] {
    const isAdminView =
      user.role && ADMIN_VIEW_USER_ROLES.includes(user.role);
    const userProjectOptions = this.getUserProjectOptions(userProjects);
    const defaultProjectOption = userProjectOptions.length === 1
      ? userProjectOptions[0]
      : undefined;
    const selectedProjectId = initialData
      ? initialData.project_id
      : defaultProjectOption?.id;

    return [
      ...(isAdminView ? this.getAdminBlocks(initialData, user) : []),
      ...SlackStaticSelectView.getView({
        blockId: 'project_block',
        actionId: 'projectId',
        label: 'Project',
        placeholder: 'Select project',
        emptyText: 'No projects available',
        options: userProjectOptions,
        initialValue: selectedProjectId,
      }),
      {
        type: 'input',
        block_id: 'date_block',
        label: { type: 'plain_text', text: 'Date' },
        element: {
          type: 'datepicker',
          action_id: 'workDate',
          initial_date: initialData?.work_date || getDateOnly(new Date()),
        },
      },
      {
        type: 'input',
        block_id: 'hours_block',
        label: { type: 'plain_text', text: 'Hours' },
        element: {
          type: 'number_input',
          action_id: 'hours',
          is_decimal_allowed: true,
          min_value: '0.25',
          max_value: '24',
          initial_value: initialData?.minutes ? (initialData.minutes / 60)?.toString() : undefined,
        },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'comment_block',
        label: { type: 'plain_text', text: 'Comment' },
        element: {
          type: 'plain_text_input',
          action_id: 'description',
          multiline: true,
          initial_value: initialData?.description || '',
        },
      },
      ...(errorMessage
        ? [this.getGeneralErrorBlock(errorMessage)]
        : []),
    ];
  }

  private getAdminBlocks(data: IGetViewParams['initialData'] | undefined, user: IUserViewModel): AnyBlock[] {
    const preselectedUser = data ? data.user : user;

    return [
      {
        type: 'input',
        block_id: 'user_block',
        label: { type: 'plain_text', text: 'User' },
        element: {
          type: 'external_select',
          action_id: TimeEntriesTabViewActionId.SelectUser,
          min_query_length: 2,
          placeholder: {
            type: 'plain_text',
            text: 'Select user',
          },
          initial_option: preselectedUser
            ? toPlainTextOption({
              id: preselectedUser.id,
              name: preselectedUser.name || 'Unknown User',
            })
            : undefined,
        },
      },
      ...SlackStaticSelectView.getView({
        blockId: 'status_block',
        actionId: 'status',
        label: 'Status',
        placeholder: 'Select status',
        options: TIME_LOG_STATUS_OPTIONS,
        initialValue: data?.status || TimeEntryStatus.Draft,
      }),
    ];
  }

  private getUserProjectOptions(userProjects: IUserProject[]): IOption[] {
    return userProjects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.clientName,
    }));
  }
}
