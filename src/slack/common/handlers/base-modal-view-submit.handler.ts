import {
  ISlackView,
  ISlackViewSubmissionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import {
  IFormParser,
  IViewParseResult,
} from '@modules/slack/common/types/form-parser.types';
import { Logger } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';

export abstract class BaseModalFormSubmitHandler<
  Metadata extends object,
  FormData extends object = object,
  SubmitResult = void,
> {
  protected readonly logger = new Logger(BaseModalFormSubmitHandler.name);

  // Domain error fields this form calls differently, e.g. { minutes: 'hours' }.
  // A field not listed here is looked up by its own name.
  protected readonly errorFields: Record<string, keyof FormData & string> = {};

  public constructor(private readonly formParser?: IFormParser<FormData>) {}

  public async handle(
    payload: ISlackViewSubmissionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata = parseMetadata<Metadata>(payload);
    const { data, errors } = this.parseForm(payload.view);

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const result = await this.onSubmit(data, metadata, user);

      return this.successResponse(result, user, metadata);
    } catch (error) {
      const fieldErrors = this.fieldErrorsOf(error, payload.view);

      // At the field it is about: Slack keeps what was typed and scrolls there.
      if (fieldErrors) {
        return SlackViewResponseFactory.errors(fieldErrors);
      }

      const kind = classifyActionError(error);
      const unexpected = kind === 'unexpected' || kind === 'not-found';

      if (unexpected) {
        this.logger.error(
          `Unexpected error in modal form submission: ${error.message}`,
          error,
        );
      }

      const errorMessage = unexpected
        ? 'Something went wrong. Please try again later.'
        : error.message;

      return this.errorResponse(errorMessage, data, metadata, user);
    }
  }

  // A form without fields (a confirmation) has no parser.
  private parseForm(view: ISlackView): IViewParseResult<FormData> {
    return this.formParser?.parse(view) ?? { data: {} as FormData };
  }

  private fieldErrorsOf(
    error: unknown,
    view: ISlackView,
  ): Record<string, string> | null {
    const field =
      error instanceof ValidationError || error instanceof DuplicatedRecordError
        ? error.field
        : undefined;
    const blockId =
      field &&
      this.formParser?.blockIdOf(this.errorFields[field] ?? field, view);

    return blockId ? { [blockId]: (error as Error).message } : null;
  }

  protected abstract onSubmit(
    data: FormData,
    meta: Metadata,
    user: IUserViewModel,
  ): Promise<SubmitResult>;

  protected abstract successResponse(
    entity: SubmitResult,
    user: IUserViewModel,
    metadata: Metadata,
  ): ViewResponseAction;

  protected abstract errorResponse(
    errorMessage: string,
    data: FormData,
    meta: Metadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> | ViewResponseAction;
}
