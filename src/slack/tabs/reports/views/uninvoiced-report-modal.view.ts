import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import {
  DATED_PERIOD_PRESETS,
  PeriodPreset,
} from '@common/utils/period-presets';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import {
  IPeriodFieldsParams,
  periodFields,
} from '@modules/slack/tabs/reports/views/period-fields';

type IGetViewParams = IBaseModalViewParams &
  Pick<IPeriodFieldsParams, 'fromDate' | 'toDate' | 'version'>;

// The uninvoiced report form: a period, all time when its dates are empty.
@Injectable()
export class UninvoicedReportModalView extends BaseModalView<IGetViewParams> {
  protected defaultCallbackId = ViewCallbackId.UninvoicedReportFormSubmit;

  protected getTitleText(): string {
    return 'Uninvoiced Time';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Show report' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({
    fromDate,
    toDate,
    version,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    return [
      ...periodFields({
        fromDate,
        toDate,
        version,
        optional: true,
        presets: [PeriodPreset.AllTime, ...DATED_PERIOD_PRESETS],
      }),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Leave a date empty to have no limit on that side: both empty is all time._',
          },
        ],
      } as AnyBlock,
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
