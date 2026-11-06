import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { VACATION_TYPE_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-type.options';
import { STATUS_OPTIONS } from '@modules/slack/tabs/vacation-requests/views/options/vacation-status.options';
import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { MAX_COMMENT_LENGTH } from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { AnyBlock } from '@slack/web-api';
import {
  VacationRequestsTabViewActionId,
} from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';

interface IGetViewParams
  extends IBaseModalViewParams<
    ViewCallbackId.AdminVacationRequest | ViewCallbackId.UserVacationRequest
  > {
  initialData?: {
    id: string;
    start_date: string;
    end_date: string;
    type: VacationType;
    comment: string;
    status: VacationRequestStatus;
    user: {
      id: string;
      name: string;
    } | null;
  };
  userRole?: UserRole;
}

export interface IVacationRequestModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

const ADMIN_VIEW_USER_ROLES = [UserRole.Admin, UserRole.HR];

@Injectable()
export class VacationRequestFormModalView extends BaseModalView<
  IGetViewParams,
  IVacationRequestModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.UserVacationRequest;

  protected getTitleText({ initialData }: IGetViewParams): string {
    return initialData ? 'Edit Vacation Request' : 'New Vacation Request';
  }

  public getViewBlocks({
    errorMessage,
    initialData,
    userRole,
    callbackId,
  }: IGetViewParams): AnyBlock[] {
    // Only the admin form lets HR and admins pick the user and the status. A
    // request from Home or `/vacations request` is the user's own, and its
    // handler ignores those fields.
    const isAdminView =
      callbackId === ViewCallbackId.AdminVacationRequest &&
      !!userRole &&
      ADMIN_VIEW_USER_ROLES.includes(userRole);

    return [
      ...(isAdminView ? this.getAdminViewBlocks(initialData) : []),
      {
        type: 'input',
        block_id: 'start_date_block',
        label: { type: 'plain_text', text: 'Start Date' },
        element: {
          type: 'datepicker',
          action_id: 'start_date',
          placeholder: { type: 'plain_text', text: 'Select a date' },
          initial_date: initialData?.start_date,
        },
      },
      {
        type: 'input',
        block_id: 'end_date_block',
        label: { type: 'plain_text', text: 'End Date' },
        element: {
          type: 'datepicker',
          action_id: 'end_date',
          placeholder: { type: 'plain_text', text: 'Select a date' },
          initial_date: initialData?.end_date,
        },
      },
      ...SlackStaticSelectView.getView({
        blockId: 'type_block',
        actionId: 'type_option',
        label: 'Vacation Type',
        placeholder: 'Select vacation type',
        options: VACATION_TYPE_OPTIONS,
        initialValue: initialData?.type,
      }),
      {
        type: 'input',
        optional: true,
        block_id: 'comment_block',
        label: { type: 'plain_text', text: 'Comment' },
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          multiline: true,
          placeholder: {
            type: 'plain_text',
            text: '"I don\'t have motivation and energy to do all this anymore..."',
          },
          max_length: MAX_COMMENT_LENGTH,
          initial_value: initialData?.comment || undefined,
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private getAdminViewBlocks(data?: IGetViewParams['initialData']) {
    return [
      {
        type: 'input',
        label: { type: 'plain_text', text: 'User' },
        block_id: 'user_id_block',
        element: {
          action_id: VacationRequestsTabViewActionId.UserField,
          type: 'external_select',
          min_query_length: 2,
          placeholder: {
            type: 'plain_text',
            text: 'All Users',
          },
          initial_option: data?.user
            ? toPlainTextOption(data?.user)
            : undefined,
        },
      },
      ...SlackStaticSelectView.getView({
        blockId: 'status_block',
        // The parser reads the field by this action_id.
        actionId: 'status',
        label: 'Vacation Status',
        placeholder: 'Select vacation status',
        options: STATUS_OPTIONS,
        initialValue: data?.status,
      }),
    ];
  }
}
