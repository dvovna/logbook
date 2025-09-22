import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class GlobalErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(GlobalErrorInterceptor.name);

  public intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      catchError((error) => {
        const type = context.getType();
        if (type === 'http') {
          return throwError(() => error);
        }

        this.logger.error(
          `[${type.toUpperCase()}] ${error.message}`,
          error.stack,
        );

        return throwError(() => error);
      }),
    );
  }
}
