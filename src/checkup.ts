import { Client } from 'pg';
import { failed, groupsOf, report, runCheckup } from 'src/checkup/checkup';

// Says what an install or an update still lacks, one line a check:
//
//   pnpm checkup                 # everything
//   pnpm checkup env database    # only these (env, database, app, slack)
//
// In the Docker image: node dist/checkup.js. It reads the same environment as
// the app, prints no secret, and exits with 1 when a check fails.

const CONNECT_TIMEOUT_MS = 5_000;

async function main() {
  const results = await runCheckup(groupsOf(process.argv.slice(2)), {
    env: process.env,
    connect: async (connectionString) => {
      const client = new Client({
        connectionString,
        connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      });

      await client.connect();

      return {
        query: async (sql) => (await client.query(sql)).rows,
        close: () => client.end(),
      };
    },
  });

  process.stdout.write(`${report(results)}\n`);
  process.exitCode = failed(results) ? 1 : 0;
}

main().catch((error: Error) => {
  process.stderr.write(`checkup failed: ${error.message}\n`);
  process.exit(1);
});
