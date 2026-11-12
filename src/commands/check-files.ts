import { existsSync, readFileSync } from 'fs';
import { checkFiles } from 'src/commands/setup-files/setup-files.command';

// Checks team and leave files before they are sent to Logbook in Slack:
//
//   pnpm files:check team-setup.csv leave-balances.csv leave-history.csv

// Dates are read as in production, which runs in UTC.
process.env.TZ = 'UTC';

checkFiles(process.argv.slice(2), {
  readFile: (path) => (existsSync(path) ? readFileSync(path) : undefined),
  print: (line) => process.stdout.write(`${line}\n`),
  today: new Date().toISOString().slice(0, 10),
})
  .then((clean) => process.exit(clean ? 0 : 1))
  .catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  });
