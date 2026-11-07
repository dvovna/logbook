import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewsPublishArguments } from '@slack/web-api/dist/types/request/views';
import { View } from '@slack/types/dist/views';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { FallbackTabView } from '@modules/slack/common/views/fallback-tab.view';
import { InactiveUserTabView } from '@modules/slack/common/views/inactive-user-tab.view';
import { trackInBackground } from '@common/utils/run-in-background';
import { canOpenTab } from '@modules/slack/common/views/data/tab-access';

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

  // Callers often don't await publish (tab navigation, after a modal submit),
  // so it must not reject: an unhandled rejection would terminate the process.
  public publish = (params: PublishParams): Promise<void> => {
    const publishing = this.publishTab(params);

    // Not every caller awaits it; either way it counts as background work.
    trackInBackground(publishing);

    return publishing;
  };

  private async publishTab(params: PublishParams) {
    // Every way into a tab ends here (navigation buttons, Retry on the error
    // view, re-rendering after a modal), so the role is checked here.
    if (!canOpenTab(this.tabId, params.user.role)) {
      this.logger.warn(
        `${params.user.slack_id} (${params.user.role}) may not open ${this.tabId}`,
      );
      this.tabNavigationService.navigate(TabId.Home, { user: params.user });

      return;
    }

    try {
      await this.slackCommunicationService.publishView(
        await this.getSafeTabView(params),
        params.user.slack_team_id,
      );
    } catch (error) {
      const { message, stack } = error as Error;

      this.logger.error(
        `Failed to publish ${this.tabId} for ${params.user?.slack_id}: ${message}`,
        stack,
      );
    }
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
