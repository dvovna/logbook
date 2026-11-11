import { z } from 'zod';
import SlackViewValuesParser from '@modules/slack/services/slack-view-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';

const parser = new SlackViewValuesParser(
  z
    .object({ fromDate: z.string(), toDate: z.string() })
    .refine(({ fromDate, toDate }) => toDate >= fromDate, {
      message: 'End date must not be before the start date',
      path: ['toDate'],
    }),
  {
    fromDate: { blockId: 'from_date_block', type: ViewFieldType.Date },
    toDate: { blockId: 'to_date_block', type: ViewFieldType.Date },
  },
);

const date = (selected_date: string) => ({
  type: 'datepicker',
  selected_date,
});

describe('SlackViewValuesParser', () => {
  it('reads a field from its block, or the block a form renamed', () => {
    expect(
      parser.parse({
        'from_date_block:last_month.1': { fromDate: date('2026-05-01') },
        to_date_block: { toDate: date('2026-05-31') },
      } as never),
    ).toEqual({ data: { fromDate: '2026-05-01', toDate: '2026-05-31' } });
  });

  it('puts an error at the block the field is in', () => {
    expect(
      parser.parse({
        'from_date_block:v2': { fromDate: date('2026-05-31') },
        'to_date_block:v2': { toDate: date('2026-05-01') },
      } as never),
    ).toEqual({
      errors: {
        'to_date_block:v2': 'End date must not be before the start date',
      },
    });
  });

  it('finds the block of a field the form renamed, for an error at it', () => {
    const values = {
      'from_date_block:v2': { fromDate: date('2026-05-01') },
      to_date_block: { toDate: date('2026-05-31') },
    } as never;

    expect(parser.blockIdOf('fromDate', values)).toBe('from_date_block:v2');
    expect(parser.blockIdOf('toDate', values)).toBe('to_date_block');
    expect(parser.blockIdOf('note', values)).toBeNull();
  });
});
