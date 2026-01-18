import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';
import { MAX_DESCRIPTION_LENGTH } from '@modules/slack/tabs/projects/parsers/project-modal-view-values.parser';

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: {
    id: string;
    name: string;
    description?: string;
  } | null;
}

export interface IProjectModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

@Injectable()
export class ProjectModalView extends BaseModalView<
  IGetViewParams,
  IProjectModalViewMetadata
> {
  protected callbackId = ViewCallbackId.ProjectFormSubmit;

  protected getTitleText(viewParams: IGetViewParams): string {
    return viewParams.initialData ? 'Edit Project' : 'Create Project';
  }

  public getViewBlocks(params: IGetViewParams): AnyBlock[] {
    const { initialData, errorMessage } = params;

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
