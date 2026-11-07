import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TIME_LOG_STATUS_OPTIONS } from '@modules/slack/tabs/time-tracking/data/time-log-status.options';
import { IOption } from '@common/types/option.interface';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserProject } from 'src/projects/queries/get-user-projects.query';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

interface IGetViewParams extends IBaseModalViewParams<
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

  // Without a project there is nothing to log time on. "Save", not
  // "Submit": an entry goes to the approvers only once it is submitted.
  protected getActionButtons(params: IGetViewParams): IActionButtons {
    return this.hasNoProjects(params)
      ? { close: { type: 'plain_text', text: 'Close' } }
      : {
          submit: { type: 'plain_text', text: 'Save' },
          close: { type: 'plain_text', text: 'Cancel' },
        };
  }

  public getViewBlocks({
    initialData,
    userProjects,
    errorMessage,
    user,
  }: IGetViewParams): AnyBlock[] {
    if (this.hasNoProjects({ initialData, userProjects })) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: 'You have no projects to log time on yet. Ask an admin to add you or your team to a project.',
          },
        },
      ];
    }

    const isAdminView = isTimeEntriesAdmin(user.role);
    const userProjectOptions = this.getUserProjectOptions(userProjects);
    const defaultProjectOption =
      userProjectOptions.length === 1 ? userProjectOptions[0] : undefined;
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
        hint: {
          type: 'plain_text',
          text: 'In 15-minute steps: 0.25 is 15 minutes, 1.5 is 1 hour 30 minutes.',
        },
        element: {
          type: 'number_input',
          action_id: 'hours',
          is_decimal_allowed: true,
          min_value: '0.25',
          max_value: '24',
          initial_value: initialData?.minutes
            ? (initialData.minutes / 60)?.toString()
            : undefined,
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
      ...(isAdminView
        ? []
        : [
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Saved as a draft. Your approvers see it once you submit it from Home.',
                },
              ],
            } as AnyBlock,
          ]),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private getAdminBlocks(
    data: IGetViewParams['initialData'] | undefined,
    user: IUserViewModel,
  ): AnyBlock[] {
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

  private hasNoProjects({
    initialData,
    userProjects,
  }: Pick<IGetViewParams, 'initialData' | 'userProjects'>) {
    return !initialData && userProjects.length === 0;
  }

  private getUserProjectOptions(userProjects: IUserProject[]): IOption[] {
    return userProjects.map((project) => ({
      id: project.id,
      name: project.name,
      description: project.clientName,
    }));
  }
}
