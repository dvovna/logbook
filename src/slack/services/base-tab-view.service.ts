import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { Inject, Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { View } from '@slack/types/dist/views';

export interface IOpenModalBaseParams {
  user: IUserViewModel;
  errorMessage?: string;
  pageMetadata?: string;
}

export interface IPublishBaseParams {
  user: IUserViewModel;
}

export type ModalViewResolversMapType = {
  [key: string]: (params: IOpenModalBaseParams) => Promise<View>;
};

@Injectable()
export default abstract class BaseTabViewService<
  ModalViewResolversMap extends ModalViewResolversMapType,
  PublishParams extends IPublishBaseParams = IPublishBaseParams,
> {
  @Inject(SlackCommunicationService)
  private readonly slackCommunicationService: SlackCommunicationService;

  protected constructor(
    protected readonly modalViewResolversMap: ModalViewResolversMap,
  ) {}

  public async publish(params: PublishParams) {
    await this.slackCommunicationService.publishView(
      await this.getTabView(params),
      params.user.slack_team_id,
    );
  }

  public async openModal<ModalName extends keyof ModalViewResolversMap>(
    triggerId: string,
    modalName: ModalName,
    params: Parameters<ModalViewResolversMap[ModalName]>[0],
  ) {
    await this.slackCommunicationService.openView(
      triggerId,
      await this.getModalView(modalName, params),
      params.user.slack_team_id,
    );
  }

  protected abstract getTabView(
    params: PublishParams,
  ): Promise<ViewsPublishArguments>;

  public getModalView<Name extends keyof ModalViewResolversMap>(
    modalName: Name,
    params: Parameters<ModalViewResolversMap[Name]>[0],
  ): Promise<View> {
    return this.modalViewResolversMap[modalName](params);
  }
}
