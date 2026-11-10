import { AnyBlock } from '@slack/web-api';
import {
  PERIOD_PRESET_NAMES,
  PeriodPreset,
} from '@common/utils/period-presets';
import { versionedBlockId } from '@modules/slack/services/slack-view-values.parser';

// The quick period select of a report form: choosing one fills its dates
// (ReportFormPresetHandler).
export const PERIOD_PRESET_ACTION_ID = 'period_preset';

export interface IPeriodFieldsParams {
  fromDate?: string;
  toDate?: string;
  presets: PeriodPreset[];
  // Dates may be left empty (the uninvoiced report: all time).
  optional?: boolean;
  // Set when a preset filled the dates: new block_ids, since Slack keeps
  // what a field with the same block_id holds when the form is updated.
  version?: string;
}

const dateField = (
  blockId: string,
  actionId: string,
  label: string,
  date: string | undefined,
  { optional, version }: IPeriodFieldsParams,
): AnyBlock =>
  ({
    type: 'input',
    block_id: version ? versionedBlockId(blockId, version) : blockId,
    label: { type: 'plain_text', text: label },
    ...(optional ? { optional: true } : {}),
    element: {
      type: 'datepicker',
      action_id: actionId,
      ...(date ? { initial_date: date } : {}),
    },
  }) as AnyBlock;

// The period of a report form: a quick period, then From and To, which the
// parsers read as `fromDate` and `toDate` in from_date_block and
// to_date_block.
export const periodFields = (params: IPeriodFieldsParams): AnyBlock[] => [
  {
    type: 'actions',
    block_id: 'period_preset_block',
    elements: [
      {
        type: 'static_select',
        action_id: PERIOD_PRESET_ACTION_ID,
        placeholder: { type: 'plain_text', text: 'Quick period' },
        options: params.presets.map((preset) => ({
          text: { type: 'plain_text', text: PERIOD_PRESET_NAMES[preset] },
          value: preset,
        })),
      },
    ],
  } as AnyBlock,
  dateField('from_date_block', 'fromDate', 'From', params.fromDate, params),
  dateField('to_date_block', 'toDate', 'To', params.toDate, params),
];
