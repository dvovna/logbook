import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IPublishBaseParams } from '@modules/slack/common/types/tab-params.types';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';

export { TabId };

type Listener<PublishParams> = (
  params: PublishParams,
) => Promise<unknown> | unknown;

@Injectable()
export class TabNavigationService {
  public constructor(private readonly eventEmitter: EventEmitter2) {}

  public navigate<
    PublishParams extends IPublishBaseParams = IPublishBaseParams,
  >(tabId: TabId, params: PublishParams) {
    this.eventEmitter.emit(tabId, params);
  }

  public onNavigate<
    PublishParams extends IPublishBaseParams = IPublishBaseParams,
  >(tabId: TabId, listener: Listener<PublishParams>) {
    this.eventEmitter.on(tabId, listener);
  }
}
