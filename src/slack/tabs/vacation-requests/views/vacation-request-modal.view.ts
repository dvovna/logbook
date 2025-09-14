import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { View } from '@slack/types/dist/views';
import BaseModalView from 'src/slack/common/views/base-modal.view';
import { VACATION_TYPE_OPTIONS } from 'src/slack/tabs/vacation-requests/views/options/vacation-type.options';
import { STATUS_OPTIONS } from 'src/slack/tabs/vacation-requests/views/options/vacation-status.options';
import { VacationRequestsTabViewActionId } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import UserRole from 'src/common/enums/user-role.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { MAX_COMMENT_LENGTH } from 'src/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';

interface IGetViewParams {
  errorMessage?: string;
  pageMetadata?: string;
  initialData?: {
    id: string;
    start_date: string;
    end_date: string;
    type: VacationType;
    comment: string;
    status: VacationStatus;
    user: {
      id: string;
      name: string;
    } | null;
  };
  userRole?: UserRole;
  callbackId:
    | ViewCallbackId.AdminVacationRequest
    | ViewCallbackId.UserVacationRequest;
}

export interface IVacationRequestModalViewMetadata {
  id: string | null;
  pageMetadata: string;
}

const ADMIN_VIEW_USER_ROLES = [UserRole.Admin, UserRole.HR];

@Injectable()
export class VacationRequestModalView extends BaseModalView<IGetViewParams> {
  public getView({
    errorMessage,
    pageMetadata,
    initialData,
    userRole,
    callbackId,
  }: IGetViewParams): View {
    const selectedVacationTypeOption = VACATION_TYPE_OPTIONS.find(
      ({ value }) => value === initialData?.type,
    );
    const isAdminView = userRole && ADMIN_VIEW_USER_ROLES.includes(userRole);

    return {
      type: 'modal',
      callback_id: callbackId,
      title: { type: 'plain_text', text: 'Request Vacation' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({
        id: initialData?.id || null,
        pageMetadata,
      } as IVacationRequestModalViewMetadata),
      blocks: [
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
        {
          type: 'input',
          block_id: 'type_block',
          label: { type: 'plain_text', text: 'Vacation Type' },
          element: {
            type: 'static_select',
            action_id: 'type_option',
            options: VACATION_TYPE_OPTIONS,
            initial_option: selectedVacationTypeOption,
          },
        },
        {
          type: 'input',
          optional: true,
          block_id: 'comment_block',
          label: { type: 'plain_text', text: 'Comment (optional)' },
          element: {
            type: 'plain_text_input',
            action_id: 'comment',
            multiline: true,
            max_length: MAX_COMMENT_LENGTH,
            initial_value: initialData?.comment || undefined,
          },
        },
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
      ],
    };
  }

  private getAdminViewBlocks(data?: IGetViewParams['initialData']) {
    const selectedStatusOption = STATUS_OPTIONS.find(
      ({ value }) => value === data?.status,
    );

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
          initial_option: data?.user?.id
            ? {
              value: data?.user?.id,
              text: { type: 'plain_text', text: data?.user?.name },
            }
            : undefined,
        },
      },
      {
        type: 'input',
        block_id: 'status_block',
        label: { type: 'plain_text', text: 'Vacation Status' },
        element: {
          type: 'static_select',
          action_id: 'status',
          options: STATUS_OPTIONS,
          initial_option: selectedStatusOption,
        },
      },
    ];
  }
}
