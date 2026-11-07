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
import {
  canOpenScreen,
  ScreenId,
  screenOfTab,
} from '@modules/slack/common/navigation/screens';
import { ScreenHeader } from '@modules/slack/common/views/components/screen-header.view';
import { PendingApprovalsService } from '@modules/slack/common/services/pending-approvals.service';
import { AnyBlock } from '@slack/web-api';

// Kept apart, so that TabNavigationService can use them without importing
// this file (which imports it).
export type {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/types/tab-params.types';
import {
  IOpenModalBaseParams,
  IPublishBaseParams,
  TAB_NOTICE_BLOCK_ID,
} from '@modules/slack/common/types/tab-params.types';

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

  @Inject(PendingApprovalsService)
  private readonly pendingApprovalsService: PendingApprovalsService;

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
    const screenId = this.screenOf(params);

    // Every way into a screen ends here (navigation buttons, Retry on the
    // error view, re-rendering after a modal), so the role is checked here.
    if (!canOpenScreen(screenId, params.user.role)) {
      this.logger.warn(
        `${params.user.slack_id} (${params.user.role}) may not open ${screenId}`,
      );
      this.tabNavigationService.navigate(TabId.Home, { user: params.user });

      return;
    }

    try {
      const tabView = await this.getSafeTabView(params);
      const header = params.user.is_active
        ? [
            ...(await this.getHeaderBlocks(screenId, params)),
            ...this.getNoticeBlocks(params.notice),
          ]
        : [];

      await this.slackCommunicationService.publishView(
        {
          ...tabView,
          view: {
            ...tabView.view,
            blocks: [...header, ...tabView.view.blocks],
          },
        },
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

  // Which screen of SCREENS the tab shows for `params`.
  protected screenOf(params: PublishParams): ScreenId {
    return screenOfTab(this.tabId, params.metadata ?? {});
  }

  private async getHeaderBlocks(screenId: ScreenId, { user }: PublishParams) {
    // Only a number on a button: without it the screen still shows.
    const approvalsCount = await this.pendingApprovalsService
      .count(user)
      .then(({ timeOff, timeEntries }) => timeOff + timeEntries)
      .catch((error: Error) => {
        this.logger.warn(`Could not count pending approvals: ${error.message}`);

        return undefined;
      });

    return ScreenHeader.getBlocks({
      screenId,
      role: user.role,
      approvalsCount,
    });
  }

  // What just happened, under the navigation, above everything else.
  private getNoticeBlocks(notice?: string): AnyBlock[] {
    return notice
      ? [
          {
            type: 'context',
            block_id: TAB_NOTICE_BLOCK_ID,
            // Plain text: a notice often names what people typed.
            elements: [{ type: 'plain_text', text: notice, emoji: true }],
          },
        ]
      : [];
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
