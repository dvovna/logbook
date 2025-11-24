import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { IPublishBaseParams } from '@modules/slack/common/services/base-tab.service';

export enum TabId {
  Home = 'home_tab',
  Holidays = 'holidays_tab',
  Users = 'users_tab',
  VacationPolicies = 'vacation_policies_tab',
  Teams = 'teams_tab',
  VacationRequests = 'vacation_requests_tab',
  VacationsHistory = 'vacations_history_tab',
}

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
