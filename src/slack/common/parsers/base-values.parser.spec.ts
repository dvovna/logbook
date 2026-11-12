import { z } from 'zod';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';

class NameParser extends BaseValuesParser<{ name: string }> {
  public constructor() {
    super(z.object({ name: z.string() }), {
      name: { blockId: 'name_block', type: ViewFieldType.Text },
    });
  }
}

const viewWith = (blockIds: string[]) =>
  ({
    blocks: blockIds.map((block_id) => ({ type: 'input', block_id })),
    state: {
      values: Object.fromEntries(blockIds.map((id) => [id, {}])),
    },
  }) as unknown as ISlackView;

describe('BaseValuesParser.blockIdOf', () => {
  const parser = new NameParser();

  it('finds the block of a field the view has, a renamed one too', () => {
    expect(parser.blockIdOf('name', viewWith(['name_block']))).toBe(
      'name_block',
    );
    expect(parser.blockIdOf('name', viewWith(['name_block:v2']))).toBe(
      'name_block:v2',
    );
  });

  it('has none for a field the view lacks or the form has no config for', () => {
    expect(parser.blockIdOf('name', viewWith(['other_block']))).toBeNull();
    expect(parser.blockIdOf('dates', viewWith(['name_block']))).toBeNull();
  });
});
