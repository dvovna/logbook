import SlackViewValuesParser, {
  IFieldsConfig,
} from '@modules/slack/services/slack-view-values.parser';
import { ZodType } from 'zod';
import { IViewStateValues } from '@modules/slack/common/types/slack-view-state-values.interface';

export default abstract class BaseValuesParser<ViewData extends object> {
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

  public parse(
    values: IViewStateValues,
  ): ReturnType<SlackViewValuesParser<ViewData>['parse']> {
    return this.valuesParser.parse(values);
  }
}
