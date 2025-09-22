import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class SlackErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SlackErrorInterceptor.name);

  public intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      catchError((err) => {
        this.logger.error(`[SLACK] ${err.message}`, err.stack);

        // вместо того, чтобы падать наружу, возвращаем «мягкий ответ»
        return throwError(() => ({
          slackError: true,
          message: '😬 Oops, something went wrong. Please contact HR.',
          originalError: err,
        }));
      }),
    );
  }
}
