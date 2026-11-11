import { ISlackViewSubmissionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import { IViewParseResult } from '@modules/slack/services/slack-view-values.parser';
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

  public constructor(
    private readonly formParser?: BaseValuesParser<FormData>,
  ) {}

  public async handle(
    payload: ISlackViewSubmissionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata = parseMetadata<Metadata>(payload);
    const { data, errors } = this.getFormData(payload);

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const result = await this.onSubmit(data, metadata, user);

      return this.successResponse(result, user, metadata);
    } catch (error) {
      const fieldErrors = this.fieldErrorsOf(error, payload);

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

  private fieldErrorsOf(
    error: unknown,
    payload: ISlackViewSubmissionPayload,
  ): Record<string, string> | null {
    const field =
      error instanceof ValidationError || error instanceof DuplicatedRecordError
        ? error.field
        : undefined;
    const blockId = field && this.blockIdOfField(field, payload);

    return blockId ? { [blockId]: (error as Error).message } : null;
  }

  // The input block that shows an error about the domain field `field`, or
  // null when the form has none (the error then shows in the modal).
  protected blockIdOfField(
    field: string,
    _payload: ISlackViewSubmissionPayload,
  ): string | null {
    return this.formParser?.blockIdOf(this.errorFields[field] ?? field) ?? null;
  }

  protected getFormData(
    payload: ISlackViewSubmissionPayload,
  ): IViewParseResult<FormData> {
    if (!this.formParser) {
      return { data: {} } as IViewParseResult<FormData>;
    }

    return this.formParser.parse(payload.view.state?.values || {});
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
