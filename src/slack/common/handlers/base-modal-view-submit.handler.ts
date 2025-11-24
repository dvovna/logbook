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
import { DuplicateError } from '@common/errors/diplicate.error';

export abstract class BaseModalFormSubmitHandler<
  Metadata extends object,
  FormData extends object = object,
  SubmitResult = void,
> {
  protected readonly logger = new Logger(BaseModalFormSubmitHandler.name);

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
      const isKnownError =
        error instanceof PrimaryEntityDeleteError ||
        error instanceof ForbiddenException ||
        error instanceof ValidationError ||
        error instanceof DuplicateError ||
        error instanceof MaxItemsCountReachedError ||
        error instanceof EntityHasDependenciesError;

      if (!isKnownError) {
        this.logger.error('Unexpected error in modal form submission:', error);
      }

      const errorMessage = isKnownError
        ? error.message
        : 'Something went wrong. Please try again later.';

      return this.errorResponse(errorMessage, data, metadata, user);
    }
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
