import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { parseMetadata } from 'src/slack/common/utils/slack-metadata.utils';
import BaseValuesParser from 'src/slack/common/parsers/base-values.parser';
import { IViewParseResult } from 'src/slack/services/slack-view-values.parser';

export abstract class BaseModalFormSubmitHandler<
  Metadata extends object,
  FormData extends object = object,
  SubmitResult = void,
> {
  public constructor(
    private readonly formParser?: BaseValuesParser<FormData>,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
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
      return this.errorResponse(error, data, metadata, user);
    }
  }

  protected getFormData(
    payload: ISlackInteractionPayload,
  ): IViewParseResult<FormData> {
    if (!this.formParser) {
      return { data: {} } as IViewParseResult<FormData>;
    }

    return this.formParser.parse(payload.view.state.values);
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
    error: unknown,
    data: FormData,
    meta: Metadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> | ViewResponseAction;
}
