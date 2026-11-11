import { ISlackView } from '@modules/slack/common/types/slack-interaction-payload.interface';

export type IViewParseResult<Data> =
  | {
      data: Data;
      errors?: never;
    }
  | {
      data?: never;
      errors: Record<string, string>;
    };

export interface IFormParser<FormData> {
  parse(view: ISlackView): IViewParseResult<FormData>;
  // The input block of the form field `field` in `view`, to show an error
  // at it; null when the form has none (the error then shows in the modal).
  blockIdOf(field: string, view: ISlackView): string | null;
}
