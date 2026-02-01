import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import UserRole from '@common/enums/user-role.enum';
import {
  TimeTrackingTabViewActionId,
} from '@modules/slack/tabs/time-tracking/enums/time-tracking-tab-view-action-id.enums';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { TIME_LOG_STATUS_OPTIONS } from '@modules/slack/tabs/time-tracking/data/time-log-status.options';
import { IOption } from '@modules/slack/common/types/option.interface';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

const ADMIN_VIEW_USER_ROLES = [UserRole.Admin, UserRole.HR];

interface IGetViewParams
  extends IBaseModalViewParams<
    ViewCallbackId.UserTimeEntry | ViewCallbackId.AdminTimeEntry
  > {
  userProjects: IOption[];
  initialData?: {
    id: string;
    workDate: string;
    project: {
      id: string;
      name: string;
    };
    hours: number;
    comment: string;
    status: TimeEntryStatus;
    user: {
      id: string;
      name: string;
    };
  };
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
    const defaultProjectOption = userProjects.length === 1 ? userProjects[0] : undefined;
    const selectedProjectId = initialData?.project?.id
      || defaultProjectOption?.id;

    return [
      ...(isAdminView ? this.getAdminBlocks(initialData, user) : []),
      ...SlackStaticSelectView.getView({
        blockId: 'project_block',
        actionId: 'projectId',
        label: 'Project',
        placeholder: 'Select project',
        emptyText: 'No projects available',
        options: userProjects,
        initialValue: selectedProjectId,
      }),
      {
        type: 'input',
        block_id: 'date_block',
        label: { type: 'plain_text', text: 'Date' },
        element: {
          type: 'datepicker',
          action_id: 'workDate',
          initial_date: initialData?.workDate || getDateOnly(new Date()),
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
          initial_value: initialData?.hours?.toString(),
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
          initial_value: initialData?.comment,
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
          action_id: TimeTrackingTabViewActionId.SelectUser,
          min_query_length: 2,
          placeholder: {
            type: 'plain_text',
            text: 'Select user',
          },
          initial_option: toPlainTextOption(preselectedUser),
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
}
