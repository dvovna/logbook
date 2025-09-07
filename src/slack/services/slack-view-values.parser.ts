import { ZodError, ZodType } from 'zod';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';
import { getValueByType } from 'src/slack/common/utils/view-utils';
import { IViewStateValues } from 'src/slack/common/types/slack-view-state-values.interface';

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

export default class SlackViewValuesParser<ViewData extends object> {
  public constructor(
    private schema: ZodType<ViewData>,
    private fieldsConfig: IFieldsConfig<ViewData>,
  ) {}

  public parse(values: IViewStateValues): IViewParseResult<ViewData> {
    try {
      const data = this.getDataFromValues(values);

      const parsedData = this.schema.parse(data);

      return { data: parsedData };
    } catch (zodError) {
      if (zodError instanceof ZodError) {
        const errors = this.formatZodError(zodError);

        return { errors };
      }

      throw zodError;
    }
  }

  private formatZodError(zodError: ZodError): Record<string, string> {
    return zodError.issues.reduce<Record<string, string>>((result, issue) => {
      const field = issue.path[0] as string;
      const blockId = this.fieldsConfig[field].blockId;

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
            blockId: config.blockId,
          }),
        };
      },
      {} as ViewData,
    );
  }
}
