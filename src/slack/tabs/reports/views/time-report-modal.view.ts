import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { DATED_PERIOD_PRESETS } from '@common/utils/period-presets';
import { IOption } from '@common/types/option.interface';
import { MAX_SELECT_OPTIONS } from '@modules/slack/common/utils/view.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import {
  TIME_REPORT_KIND_NAMES,
  TimeReportFilterId,
  TimeReportKind,
} from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import {
  IPeriodFieldsParams,
  periodFields,
} from '@modules/slack/tabs/reports/views/period-fields';

interface IGetViewParams
  extends
    IBaseModalViewParams,
    Pick<IPeriodFieldsParams, 'fromDate' | 'toDate' | 'version'> {
  kinds: TimeReportKind[];
  // The clients to filter by; none: no Client filter.
  clients: IOption[];
  // Whether the viewer sees other people's time, so may filter by person.
  withPerson: boolean;
}

const externalSelect = (
  actionId: TimeReportFilterId,
  label: string,
  placeholder: string,
): AnyBlock =>
  ({
    type: 'input',
    block_id: `${actionId}_block`,
    optional: true,
    label: { type: 'plain_text', text: label },
    element: {
      type: 'external_select',
      action_id: actionId,
      placeholder: { type: 'plain_text', text: placeholder },
      min_query_length: 0,
    },
  }) as AnyBlock;

// The time report form: what to report, the period (a quick period fills the
// dates), and optional filters, which the report and its CSV share.
@Injectable()
export class TimeReportModalView extends BaseModalView<IGetViewParams> {
  protected defaultCallbackId = ViewCallbackId.TimeReportFormSubmit;

  protected getTitleText(): string {
    return 'Time Report';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Show report' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({
    kinds,
    fromDate,
    toDate,
    version,
    clients,
    withPerson,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    return [
      ...SlackStaticSelectView.getView({
        blockId: 'kind_block',
        actionId: 'kind',
        label: 'Report',
        options: kinds.map((kind) => ({
          id: kind,
          name: TIME_REPORT_KIND_NAMES[kind],
        })),
        initialValue: TimeReportKind.Project,
      }),
      ...periodFields({
        fromDate,
        toDate,
        version,
        presets: DATED_PERIOD_PRESETS,
      }),
      ...(clients.length
        ? SlackStaticSelectView.getView({
            blockId: `${TimeReportFilterId.Client}_block`,
            actionId: TimeReportFilterId.Client,
            label: 'Client',
            placeholder: 'Any client',
            options: clients.slice(0, MAX_SELECT_OPTIONS),
            optional: true,
          })
        : []),
      externalSelect(TimeReportFilterId.Project, 'Project', 'Any project'),
      ...(withPerson
        ? [externalSelect(TimeReportFilterId.Person, 'Person', 'Anyone')]
        : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: "_The filters narrow the report and its CSV; Who hasn't submitted doesn't use them._",
          },
        ],
      } as AnyBlock,
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
