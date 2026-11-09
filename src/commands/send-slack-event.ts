import { createHmac } from 'crypto';
import { readFileSync } from 'fs';

// Sends a Slack Events API payload to the running app, signed the way Slack
// signs it, so event handlers can be checked without Slack or a public URL:
//
//   pnpm slack:event src/commands/slack-events/team-join.json --team T0123ABCD
//
// The sample payloads use T_LOCAL as the workspace ID; --team replaces it with
// the slack_id of a workspace that exists in the database.
// --url overrides the target (default: http://localhost:$PORT/api/slack/events).

const PLACEHOLDER_TEAM_ID = 'T_LOCAL';

interface ISendEventOptions {
  payloadPath: string;
  teamId?: string;
  url: string;
}

function parseArgs(args: string[]): ISendEventOptions {
  const [payloadPath, ...flags] = args;

  if (!payloadPath) {
    throw new Error(
      'Usage: pnpm slack:event <payload.json> [--team <T-id>] [--url <url>]',
    );
  }

  const options: ISendEventOptions = {
    payloadPath,
    url: `http://localhost:${process.env.PORT || 3000}/api/slack/events`,
  };

  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];

    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === '--team') {
      options.teamId = value;
    } else if (flag === '--url') {
      options.url = value;
    } else {
      throw new Error(`Unknown option ${flag}`);
    }
  }

  return options;
}

async function sendSlackEvent() {
  const signingSecret = process.env.SLACK_SIGN_IN_SECRET;

  if (!signingSecret) {
    throw new Error('SLACK_SIGN_IN_SECRET is not set');
  }

  const { payloadPath, teamId, url } = parseArgs(process.argv.slice(2));

  let body = readFileSync(payloadPath, 'utf8');

  if (teamId) {
    body = body.replaceAll(PLACEHOLDER_TEAM_ID, teamId);
  }

  // Fail here rather than with a 500 from the app.
  JSON.parse(body);

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature =
    'v0=' +
    createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${body}`)
      .digest('hex');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slack-Request-Timestamp': timestamp,
      'X-Slack-Signature': signature,
    },
    body,
  });

  process.stdout.write(`${response.status} ${await response.text()}\n`);

  if (!response.ok) {
    process.exitCode = 1;
  }
}

sendSlackEvent().catch((error: Error) => {
  process.stderr.write(`slack:event failed: ${error.message}\n`);
  process.exit(1);
});
