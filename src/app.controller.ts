import { Controller, Get, Logger, Res } from '@nestjs/common';
import { Response } from 'express';
import { SupabaseService } from 'src/database/supabase.service';
import { DatabaseService } from 'src/database/database.service';
import { RpcFunctionName } from '@common/enums/rpc-function-name';

// How long /health waits for the database before it reports it down.
export const HEALTH_TIMEOUT_MS = 3000;

@Controller()
export class AppController {
  private readonly logger = new Logger(AppController.name);

  public constructor(
    private readonly supabase: SupabaseService,
    private readonly database: DatabaseService,
  ) {}

  @Get()
  public getStatus(): string {
    return 'Up and running!';
  }

  // For the platform's or Docker's health check: 200 while the app can
  // reach its database both ways it uses, through the Supabase API and its
  // own connections (DATABASE_URL), 503 when it can't.
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
    const throughApi = (async () => {
      const { error } = await this.supabase
        .getClient()
        .rpc(RpcFunctionName.AppliedMigrations);

      return error ? `the database: ${error.message}` : null;
    })().catch((error: Error) => `the database: ${error.message}`);
    const throughPool = this.database
      .ping()
      .then(() => null)
      .catch((error: Error) => `the database connection: ${error.message}`);
    const query = Promise.all([throughApi, throughPool]).then(
      (problems) => problems.filter(Boolean).join('; ') || null,
    );

    return Promise.race([query, timeout]).finally(() => clearTimeout(timer));
  }
}
