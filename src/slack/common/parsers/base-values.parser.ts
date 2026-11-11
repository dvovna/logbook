import SlackViewValuesParser, {
  IFieldsConfig,
} from '@modules/slack/services/slack-view-values.parser';
import { ZodType } from 'zod';
import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  IFormParser,
  IViewParseResult,
} from '@modules/slack/common/types/form-parser.types';

// A form of fixed fields, each read from its block by its config.
export default abstract class BaseValuesParser<
  ViewData extends object,
> implements IFormParser<ViewData> {
  protected valuesParser: SlackViewValuesParser<ViewData>;

  public constructor(
    schema: ZodType<ViewData>,
    fieldsConfig: IFieldsConfig<ViewData>,
  ) {
    this.valuesParser = new SlackViewValuesParser<ViewData>(
      schema,
      fieldsConfig,
    );
  }

  // Slack refuses errors at a block the view doesn't have.
  public blockIdOf(field: string, view: ISlackView): string | null {
    const blockId = this.valuesParser.blockIdOf(
      field,
      view.state?.values ?? {},
    );

    return blockId &&
      (view.blocks ?? []).some((block) => block.block_id === blockId)
      ? blockId
      : null;
  }

  public parse(view: ISlackView): IViewParseResult<ViewData> {
    return this.valuesParser.parse(view.state?.values ?? {});
  }
}
