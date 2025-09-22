import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { View } from '@slack/types/dist/views';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { FallbackTabView } from 'src/slack/common/views/fallback-tab.view';
import { InactiveUserTabView } from 'src/slack/common/views/inactive-user-tab.view';

export type IOpenModalBaseParams<PageMetadata = undefined> = {
  user: IUserViewModel;
  errorMessage?: string;
} & (PageMetadata extends undefined
  ? object
  : {
      pageMetadata: PageMetadata;
    });

export interface IPublishBaseParams<TabMetadata = unknown> {
  user: IUserViewModel;
  metadata?: TabMetadata;
}

export type ModalViewResolversMapType = {
  [key: string]: (params: IOpenModalBaseParams) => Promise<View> | View;
};

@Injectable()
export default abstract class BaseTabService<
  ModalViewResolversMap extends ModalViewResolversMapType,
  PublishParams extends IPublishBaseParams = IPublishBaseParams,
> {
  private readonly logger = new Logger(BaseTabService.name);

  @Inject(SlackCommunicationService)
  private readonly slackCommunicationService: SlackCommunicationService;

  @Inject(TabNavigationService)
  private readonly tabNavigationService: TabNavigationService;

  @Inject(FallbackTabView)
  private readonly fallbackTabView: FallbackTabView;

  @Inject(InactiveUserTabView)
  private readonly inactiveTabView: InactiveUserTabView;

  protected constructor(
    private tabId: TabId,
    protected readonly modalViewResolversMap?: ModalViewResolversMap,
  ) {}

  public onModuleInit() {
    this.tabNavigationService.onNavigate<PublishParams>(
      this.tabId,
      this.publish,
    );
  }

  public publish = async (params: PublishParams) => {
    await this.slackCommunicationService.publishView(
      await this.getSafeTabView(params),
      params.user.slack_team_id,
    );
  };

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

  protected getFallbackTabView(params: PublishParams) {
    return this.fallbackTabView.getView({
      userId: params.user.slack_id,
      userRole: params.user.role,
      tabId: this.tabId,
    });
  }

  public getModalView<Name extends keyof ModalViewResolversMap>(
    modalName: Name,
    params: Parameters<ModalViewResolversMap[Name]>[0],
  ): Promise<View> | View {
    if (!this.modalViewResolversMap?.[modalName]) {
      throw new Error(`Modal view resolver not found`);
    }

    return this.modalViewResolversMap[modalName](params);
  }

  private async getSafeTabView(params: PublishParams) {
    try {
      if (!params.user.is_active) {
        return this.inactiveTabView.getView({
          userId: params.user.slack_id,
          userRole: params.user.role,
        });
      }

      return await this.getTabView(params);
    } catch (error) {
      this.logger.error(error);

      return this.getFallbackTabView(params);
    }
  }
}
