import { ISlackViewSubmissionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import BaseValuesParser from '@modules/slack/common/parsers/base-values.parser';
import { IViewParseResult } from '@modules/slack/services/slack-view-values.parser';
import PrimaryEntityDeleteError from '@common/errors/primary-entity-delete.error';
import { ForbiddenException, Logger } from '@nestjs/common';
import EntityHasDependenciesError from '@common/errors/entity-has-dependencies.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { ValidationError } from '@common/errors/validation.error';
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
      const fieldErrors = this.fieldErrorsOf(error);

      // At the field it is about: Slack keeps what was typed and scrolls there.
      if (fieldErrors) {
        return SlackViewResponseFactory.errors(fieldErrors);
      }

      const isKnownError =
        error instanceof PrimaryEntityDeleteError ||
        error instanceof ForbiddenException ||
        error instanceof ValidationError ||
        error instanceof DuplicatedRecordError ||
        error instanceof MaxItemsCountReachedError ||
        error instanceof EntityHasDependenciesError;

      if (!isKnownError) {
        this.logger.error(
          `Unexpected error in modal form submission: ${error.message}`,
          error,
        );
      }

      const errorMessage = isKnownError
        ? error.message
        : 'Something went wrong. Please try again later.';

      return this.errorResponse(errorMessage, data, metadata, user);
    }
  }

  private fieldErrorsOf(error: unknown): Record<string, string> | null {
    const field =
      error instanceof ValidationError || error instanceof DuplicatedRecordError
        ? error.field
        : undefined;

    if (!field || !this.formParser) {
      return null;
    }

    const blockId = this.formParser.blockIdOf(this.errorFields[field] ?? field);

    return blockId ? { [blockId]: (error as Error).message } : null;
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
