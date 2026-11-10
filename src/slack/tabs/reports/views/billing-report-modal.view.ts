import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { SlackStaticSelectView } from '@modules/slack/common/views/components/slack-static-select.view';
import { getDisplayTime } from '@common/utils/time.utils';
import IClientViewModel from '@modules/clients/types/client.interface';
import { DATED_PERIOD_PRESETS } from '@common/utils/period-presets';
import {
  IPeriodFieldsParams,
  periodFields,
} from '@modules/slack/tabs/reports/views/period-fields';

interface IGetViewParams
  extends
    IBaseModalViewParams,
    Pick<IPeriodFieldsParams, 'fromDate' | 'toDate' | 'version'> {
  clients: IClientViewModel[];
}

const hours = (minutes: number) => (minutes ? getDisplayTime(minutes) : '0h');

// The billing report form: a client and a period.
@Injectable()
export class BillingReportModalView extends BaseModalView<IGetViewParams> {
  protected defaultCallbackId = ViewCallbackId.BillingReportFormSubmit;

  protected getTitleText(): string {
    return 'Billing Report';
  }

  protected getActionButtons({ clients }: IGetViewParams): IActionButtons {
    return clients.length
      ? {
          submit: { type: 'plain_text', text: 'Show report' },
          close: { type: 'plain_text', text: 'Cancel' },
        }
      : { close: { type: 'plain_text', text: 'Close' } };
  }

  public getViewBlocks({
    clients,
    fromDate,
    toDate,
    version,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    return [
      ...SlackStaticSelectView.getView({
        blockId: 'client_block',
        actionId: 'clientId',
        label: 'Client',
        placeholder: 'Select client',
        emptyText: 'No clients yet. Add one under More → Clients.',
        options: clients.map((client) => ({
          id: client.id,
          name: client.archived_at ? `${client.name} (archived)` : client.name,
        })),
      }),
      ...(clients.length
        ? periodFields({
            fromDate,
            toDate,
            version,
            presets: DATED_PERIOD_PRESETS,
          })
        : []),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
