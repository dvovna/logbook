import type { IPendingApprovals } from '@modules/slack/common/services/pending-approvals.service';
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
  // What waits for the viewer's decision: counted once per publish by
  // BaseTabService, beside the screen's own reads, for the Approvals button
  // and for Home. Never rejects; undefined when it couldn't be counted.
  pendingApprovals?: Promise<IPendingApprovals | undefined>;
  // Whether the workspace has a project, read once per publish beside the
  // screen's own reads, for the navigation and for Home.
  tracksTime?: Promise<boolean>;
}

export const TAB_NOTICE_BLOCK_ID = 'tab_notice';
