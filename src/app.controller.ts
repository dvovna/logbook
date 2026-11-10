import { Controller, Get, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { DatabaseService } from 'src/database/database.service';

// How long /health waits for the database before it reports it down.
export const HEALTH_TIMEOUT_MS = 3000;

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  public constructor(private readonly database: DatabaseService) {}

  @Get()
  public getStatus(): string {
    return 'Up and running!';
  }

  // For the platform's or Docker's health check: 200 while the app's own
  // connections (DATABASE_URL) reach the database, 503 when they don't.
  @Get('health')
  public async getHealth(@Res() res: Response) {
    const problem = await this.findDatabaseProblem();

    if (problem) {
      this.logger.warn(`Health check: ${problem}`);
      res.status(503).json({ status: 'unavailable' });

      return;
    }

    res.status(200).json({ status: 'ok' });
  }

  private async findDatabaseProblem(): Promise<string | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(
        () => resolve(`the database didn't answer in ${HEALTH_TIMEOUT_MS} ms`),
        HEALTH_TIMEOUT_MS,
      );
    });
    const query = this.database
      .ping()
      .then(() => null)
      .catch((error: Error) => `the database: ${error.message}`);

    return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
  }
}
