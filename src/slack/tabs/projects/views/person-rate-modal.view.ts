import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { formatHourlyRate } from '@common/utils/money.utils';
import IProjectViewModel from 'src/projects/types/project.types';
import { IPersonRate } from 'src/projects/types/project-user-rate.types';
import { PersonRateModalActionId } from '@modules/slack/tabs/projects/enums/person-rate-modal-action-id.enum';
import { hourlyRateElement } from '@modules/slack/tabs/projects/parsers/hourly-rate.schema';

interface IGetViewParams extends IBaseModalViewParams {
  project: IProjectViewModel;
  personRates: IPersonRate[];
  currency: string;
}

export interface IPersonRateModalViewMetadata {
  id: string;
  pageMetadata: string;
}

// Sets one person's own rate on a project, or removes it: the project's
// rate and the rates set so far, then whose rate and the rate.
@Injectable()
export class PersonRateModalView extends BaseModalView<
  IGetViewParams,
  IPersonRateModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.PersonRateFormSubmit;

  protected getTitleText(): string {
    return 'Person Rates';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({
    project,
    personRates,
    currency,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    const projectRate =
      project.hourly_rate === null
        ? `*${escapeMrkdwn(project.name)}* has no rate of its own: set one in Edit Project.`
        : `*${escapeMrkdwn(project.name)}*: *${formatHourlyRate(project.hourly_rate, currency)}*.`;

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${projectRate}\nA person's own rate replaces the project's for their time on it.`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: personRates.length
            ? [
                '*Own rates*',
                ...personRates.map(
                  ({ name, hourlyRate }) =>
                    `• ${escapeMrkdwn(name)} — ${formatHourlyRate(hourlyRate, currency)}`,
                ),
              ].join('\n')
            : '_Nobody has a rate of their own on this project yet._',
        },
      },
      {
        type: 'input',
        block_id: 'person_block',
        label: { type: 'plain_text', text: 'Person' },
        element: {
          type: 'external_select',
          action_id: PersonRateModalActionId.Person,
          placeholder: { type: 'plain_text', text: 'Choose a person' },
          min_query_length: 2,
        },
      },
      {
        type: 'input',
        block_id: 'hourly_rate_block',
        optional: true,
        label: { type: 'plain_text', text: `Hourly rate (${currency})` },
        element: hourlyRateElement(PersonRateModalActionId.HourlyRate),
        hint: {
          type: 'plain_text',
          text: "Leave it empty to remove the person's own rate: the project's rate applies again.",
        },
      } as AnyBlock,
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
