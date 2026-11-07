import { IUserViewModel } from '@modules/users/types/user.interface';

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
  // What just happened, e.g. "✅ Saved · 1h 30m on Website": shown once, at
  // the top of the tab, after a form closed or an action ran.
  notice?: string;
}

export const TAB_NOTICE_BLOCK_ID = 'tab_notice';
