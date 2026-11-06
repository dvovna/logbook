import { IUserViewModel } from '@modules/users/types/user.interface';

declare module 'express' {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Request {
    user?: IUserViewModel;
  }
}
