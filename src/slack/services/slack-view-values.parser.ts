import { ZodError, ZodType } from 'zod';
import ViewFieldType from '@modules/slack/enums/view-field-type.enum';
import { getValueByType } from '@modules/slack/common/utils/parsing-utils';
import { IViewStateValues } from '@modules/slack/common/types/slack-view-state-values.interface';

export type IViewParseResult<Data> =
  | {
      data: Data;
      errors?: never;
    }
  | {
      data?: never;
      errors: Record<string, string>;
    };

interface IFieldConfig {
  type: ViewFieldType;
  blockId: string;
}

export type IFieldsConfig<ViewData> = {
  [field in keyof ViewData & string]: IFieldConfig;
};

// The block a field sits in: its configured block_id, or that id with a
// `:version` after it. A form gives a field a new block_id to change what it
// shows (views.update keeps what a field with the same block_id holds), e.g.
// the dates a period preset fills in.
export const versionedBlockId = (blockId: string, version: string) =>
  `${blockId}:${version}`;

const blockIdIn = (values: IViewStateValues, blockId: string) =>
  blockId in values
    ? blockId
    : (Object.keys(values).find((id) => id.startsWith(`${blockId}:`)) ??
      blockId);

export default class SlackViewValuesParser<ViewData extends object> {
  public constructor(
    private schema: ZodType<ViewData>,
    private fieldsConfig: IFieldsConfig<ViewData>,
  ) {}

  // The block a form field sits in, to show an error at it.
  public blockIdOf(field: string): string | undefined {
    return (this.fieldsConfig as Record<string, IFieldConfig | undefined>)[
      field
    ]?.blockId;
  }

  public parse(values: IViewStateValues): IViewParseResult<ViewData> {
    try {
      const data = this.getDataFromValues(values);

      const parsedData = this.schema.parse(data);

      return { data: parsedData };
    } catch (zodError) {
      if (zodError instanceof ZodError) {
        const errors = this.formatZodError(zodError, values);

        return { errors };
      }

      throw zodError;
    }
  }

  private formatZodError(
    zodError: ZodError,
    values: IViewStateValues,
  ): Record<string, string> {
    return zodError.issues.reduce<Record<string, string>>((result, issue) => {
      const field = issue.path[0] as string;
      const blockId =
        this.fieldsConfig[field].blockId &&
        blockIdIn(values, this.fieldsConfig[field].blockId);

      if (blockId) {
        result[blockId] = issue.message;
      } else {
        result['_general'] = issue.message; // fallback to general error
      }

      return result;
    }, {});
  }

  private getDataFromValues(values: IViewStateValues): ViewData {
    return Object.entries<IFieldConfig>(this.fieldsConfig).reduce<ViewData>(
      (result, [field, config]) => {
        return {
          ...result,
          [field]: getValueByType(values, config.type, {
            actionId: field,
            blockId: blockIdIn(values, config.blockId),
          }),
        };
      },
      {} as ViewData,
    );
  }
}
