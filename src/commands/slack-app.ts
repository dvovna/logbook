import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { Writable } from 'stream';
import { slackApp } from 'src/commands/slack-app/slack-app.command';

// Creates or updates the Slack app from slack-app-manifest.yml through
// Slack's manifest API, so nobody copies URLs and secrets by hand:
//
//   pnpm slack:app create --domain logbook.example.com
//   pnpm slack:app update --domain 1cb0-3-64-155-19.ngrok-free.app
//   pnpm slack:app validate

// The token is a secret: taken from the environment, or typed without an
// echo, never from an argument (arguments show in the process list and the
// shell's history).
const configToken = async (): Promise<string> => {
  if (process.env.SLACK_CONFIG_TOKEN) {
    return process.env.SLACK_CONFIG_TOKEN;
  }

  if (!process.stdin.isTTY) {
    throw new Error(
      'Set SLACK_CONFIG_TOKEN to an app configuration token (https://api.slack.com/apps, "Your App Configuration Tokens"), or run the command in a terminal to be asked for it',
    );
  }

  process.stderr.write('App configuration token (not shown): ');

  const input = createInterface({
    input: process.stdin,
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    terminal: true,
  });

  return new Promise((resolve) =>
    input.question('', (answer) => {
      input.close();
      process.stderr.write('\n');
      resolve(answer.trim());
    }),
  );
};

slackApp(process.argv.slice(2), {
  readFile: (path) =>
    existsSync(path) ? readFileSync(path, 'utf8') : undefined,
  // A .env holds secrets: readable by its owner only when this creates it.
  writeFile: (path, content) => writeFileSync(path, content, { mode: 0o600 }),
  token: configToken,
  print: (line) => process.stdout.write(`${line}\n`),
}).catch((error: Error) => {
  process.stderr.write(`slack:app failed: ${error.message}\n`);
  process.exit(1);
});
