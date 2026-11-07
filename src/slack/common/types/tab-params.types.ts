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
}
