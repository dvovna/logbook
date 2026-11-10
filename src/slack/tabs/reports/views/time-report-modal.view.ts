import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import {
  TIME_REPORT_KIND_NAMES,
  TimeReportKind,
} from '@modules/slack/tabs/reports/enums/time-report-kind.enum';

interface IGetViewParams extends IBaseModalViewParams {
  kinds: TimeReportKind[];
  fromDate: string;
  toDate: string;
}

// The time report form: what to report and the period.
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
      {
        type: 'input',
        block_id: 'from_date_block',
        label: { type: 'plain_text', text: 'From' },
        element: {
          type: 'datepicker',
          action_id: 'fromDate',
          initial_date: fromDate,
        },
      } as AnyBlock,
      {
        type: 'input',
        block_id: 'to_date_block',
        label: { type: 'plain_text', text: 'To' },
        element: {
          type: 'datepicker',
          action_id: 'toDate',
          initial_date: toDate,
        },
      } as AnyBlock,
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
