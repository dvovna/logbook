import {
  labelOptions,
  PROJECT_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { MAX_DESCRIPTION_LENGTH } from '@modules/slack/tabs/projects/parsers/project-modal-view-values.parser';
import IClientViewModel from '@modules/clients/types/client.interface';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import IProjectViewModel from 'src/projects/types/project.types';
import { toPlainTextOption } from '@modules/slack/common/utils/view.utils';
import { hourlyRateElement } from '@modules/slack/tabs/projects/parsers/hourly-rate.schema';

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: IProjectViewModel | null;
  clients: IClientViewModel[];
  // The workspace's, for the rate's label.
  currency: string;
}

export interface IProjectModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

export const NO_CLIENT_VALUE = 'NO_CLIENT';

const NO_CLIENT_OPTION: PlainTextOption = {
  text: { type: 'plain_text', text: 'No Client' },
  value: NO_CLIENT_VALUE,
};

@Injectable()
export class ProjectModalView extends BaseModalView<
  IGetViewParams,
  IProjectModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ProjectFormSubmit;

  protected getTitleText(viewParams: IGetViewParams): string {
    return viewParams.initialData ? 'Edit Project' : 'Create Project';
  }

  public getViewBlocks({
    initialData,
    clients,
    currency,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const clientOptions = clients.map<PlainTextOption>((client) =>
      toPlainTextOption({
        id: client.id,
        name: client.name,
      }),
    );
    const selectedClient = initialData?.client_id
      ? clientOptions.find((client) => client.value === initialData?.client_id)
      : NO_CLIENT_OPTION;

    return [
      {
        type: 'input',
        block_id: 'name_block',
        element: {
          type: 'plain_text_input',
          action_id: 'name',
          initial_value: initialData?.name || '',
        },
        label: {
          type: 'plain_text',
          text: 'Project Name',
        },
      },
      {
        type: 'input',
        block_id: 'client_block',
        label: { type: 'plain_text', text: 'Client' },
        element: {
          type: 'static_select',
          action_id: 'clientId',
          options: [NO_CLIENT_OPTION, ...clientOptions],
          initial_option: selectedClient,
        },
      },
      {
        type: 'input',
        block_id: 'billable_block',
        label: {
          type: 'plain_text',
          text: 'Billable',
        },
        element: {
          type: 'radio_buttons',
          action_id: 'billable',
          options: [
            {
              text: { type: 'plain_text', text: 'Yes' },
              value: 'true',
            },
            {
              text: { type: 'plain_text', text: 'No' },
              value: 'false',
            },
          ],
          initial_option: {
            text: {
              type: 'plain_text',
              text: !initialData || initialData.billable ? 'Yes' : 'No',
            },
            value: !initialData || initialData.billable ? 'true' : 'false',
          },
        },
      },
      {
        type: 'input',
        block_id: 'hourly_rate_block',
        optional: true,
        label: { type: 'plain_text', text: `Hourly rate (${currency})` },
        element: hourlyRateElement('hourlyRate', initialData?.hourly_rate),
        hint: {
          type: 'plain_text',
          text: "What an hour of billable time costs the client. A person's own rate (Person Rates in the project's menu) replaces it. Empty: no rate, so no amount.",
        },
      } as AnyBlock,
      {
        type: 'input',
        block_id: 'status_block',
        label: {
          type: 'plain_text',
          text: 'Project Status',
        },
        element: {
          type: 'static_select',
          action_id: 'status',
          options: labelOptions(PROJECT_STATUS_LABELS).map(toPlainTextOption),
          initial_option: toPlainTextOption({
            id: initialData?.status || ProjectStatus.Active,
            name: withIcon(
              PROJECT_STATUS_LABELS[
                initialData?.status || ProjectStatus.Active
              ],
            ),
          }),
        },
      },
      {
        type: 'input',
        block_id: 'description_block',
        optional: true,
        element: {
          type: 'plain_text_input',
          multiline: true,
          action_id: 'description',
          max_length: MAX_DESCRIPTION_LENGTH,
          initial_value: initialData?.description || '',
        },
        label: {
          type: 'plain_text',
          text: 'Description',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
