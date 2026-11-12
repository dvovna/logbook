# Install Logbook: instructions for an AI agent

You are an AI coding agent, and the person you work with asked you to install Logbook, a self-hosted Slack app for time off and time tracking (https://github.com/dvovna/logbook). Follow these steps in order. The same guide for people is at https://dvovna.github.io/logbook/docs/self-hosting/install/; when a detail is missing here, read it there, not elsewhere.

These instructions are for Logbook 0.5.0 or later. Step 2 checks out the latest release; if it is older, stop and say so.

## Rules

1. **Secrets never go through the chat.** Don't print, quote or summarize the content of `.env`, a database password, a connection string, a Slack secret or a token. Don't ask the person to paste one into the chat. A secret goes from the tool that makes it straight into `.env`, or the person types it into their own terminal. To see whether a value is set, run `pnpm checkup env`: it names variables and never shows values.
2. **Ask before anything that costs money, is public, or can't be undone:** installing software on the machine, creating a Supabase project, applying migrations to a database, creating a Slack app, creating an app or a server on a hosting platform, deploying to it (that starts the paid machine and puts the site online), pointing DNS. Say what you are about to do, and what it costs when it costs, and wait for a yes. One yes covers one action.
3. **Never** turn on the Slack app's public distribution, use Slack's "Install to Workspace" button or its sharable URL, change a database outside the migrations, or apply migrations to a database the person didn't name.
4. **Check after every step** with the command the step gives. When a check fails, read its line and the `→` line under it, fix that, and run it again. Don't go on with a failing check unless the step says the failure is expected at that point.
5. **Stop and ask** when something here doesn't match what you see: a command that doesn't exist, a different prompt, an error you don't understand. Don't guess and don't reach for another tool.
6. Work in the `logbook` folder the next steps create. Don't count on a shell variable, or a Node version chosen with `nvm use`, being there for the next command: the steps keep what they need in files, and step 2 says how to run each command with Node 26. Run commands that take longer than a couple of minutes in the background.
7. **Don't take "it worked" or "it failed" on trust** when the person ran a command for you: check with the command the step gives, which shows what is set without showing values.

## 1. Ask the person, once

Ask these together, before you start, and repeat the answers back:

- **Where will Logbook run?** A server of theirs with Docker (Compose 2.24 or later) and a domain; Fly.io; Render; or only this machine for a trial (it then needs a tunnel such as ngrok, and stops when the machine does). Say what each costs before they choose: Logbook has to be awake all the time, since Slack waits 3 seconds for an answer and a free plan that sleeps takes longer to wake up. On Fly.io that is one small machine that never stops (a few dollars a month, see https://fly.io/docs/about/pricing/), and Fly asks for a card on file before the first deploy. On Render it is the paid Starter plan (https://render.com/pricing).
- **For Fly.io:** the app's name, which becomes the domain `<name>.fly.dev` and has to be free across all of Fly; the organization, if they have more than one; and that a card is on file (Dashboard → Billing). Without a card the deploy of step 6 fails after everything else is done.
- **For a server of theirs:** can you reach it over `ssh` from here, or will they run the commands on it themselves?
- **For Render:** a fork of https://github.com/dvovna/logbook on their GitHub account, since Render reads the Blueprint from a repository of theirs. Ask them to fork it now and give you its address.
- **The domain**, if they have one (for a server of theirs). On Fly.io and Render the platform gives it.
- **The database:** an existing Supabase project (its project ref), or a new one. For a new one: which organization, and which region. The free plan runs Logbook but keeps no backups and pauses after a week without activity; say so. It also allows two active free projects per organization owner: if they have two already, a third needs one paused or a paid plan.
- **The Slack workspace** the app is for, and that they may create apps in it.

Logbook must run in the region of its database: a click sends several SQL statements one after another, and Slack waits 3 seconds. If the two regions they name differ, say so and ask again. The same region under each name:

| Supabase | Fly.io | Render |
| --- | --- | --- |
| `us-east-1` | `iad` | `virginia` |
| `us-east-2` | `ord` | `ohio` |
| `us-west-1`, `us-west-2` | `sjc`, `sea` | `oregon` |
| `eu-central-1` | `fra` | `frankfurt` |
| `ap-southeast-1` | `sin` | `singapore` |

## 2. The tools and the source

```bash
node --version    # 26 or later
docker --version  # for a server of theirs or a trial; not for Fly.io or Render
fly version       # for Fly.io
npm install -g pnpm@10
git clone https://github.com/dvovna/logbook && cd logbook
git checkout "$(git tag --list 'v*' --sort=-v:refname | head -1)"
pnpm install
```

- **Node.** If `node --version` is older than 26 and the person uses nvm, look whether 26 is installed (`ls ~/.nvm/versions/node`). If it is, start every command of this guide with `source ~/.nvm/nvm.sh && nvm use 26 >/dev/null &&`, since the choice doesn't last from one command to the next; if not, ask them to run `nvm install 26`. Tell the person that their own terminal needs `nvm use 26` too, before the command of step 5.
- **The `fly` CLI**, for Fly.io. If it is missing, install it (ask first, rule 2): `brew install flyctl` on a Mac with Homebrew, else `curl -L https://fly.io/install.sh | sh`. Then `fly auth whoami`; if it isn't signed in, ask the person to run `fly auth login` now, with the Supabase sign-in of step 3.

For Render, clone the person's fork instead of `dvovna/logbook`, then `git remote add upstream https://github.com/dvovna/logbook && git fetch upstream --tags` before the checkout.

Tell the person which version you checked out. If `npm install -g` fails for lack of permission, stop and ask: Node 26 has no corepack to fall back on.

Check: `pnpm checkup env` runs and lists the variables that are not set. Every failure is expected for now.

## 3. The database

The Supabase CLI is in the source: run it as `pnpm supabase …`, never another version. It prints a notice about a newer version after every command, and "Cannot find project ref" before a project is linked: ignore both.

1. Sign in: `pnpm supabase projects list`. If it says you are not logged in, ask the person to run `pnpm supabase login` in their terminal, and wait. The list is JSON; a project that is ready has the status `ACTIVE_HEALTHY`. For a new project on the free plan, count the active projects of the organization first: with two already, creating a third fails with `free_project_limit`, so settle that with the person before you ask for the yes.
2. **A new project** (ask first, rule 2). Make a password without showing it, in a file only you can read and git doesn't see:
   ```bash
   echo .db-password >> .git/info/exclude
   (umask 077 && openssl rand -base64 24 | tr -d '/+=\n' > .db-password)
   pnpm supabase orgs list
   pnpm supabase projects create logbook --org-id <org id> --region <region> --db-password "$(cat .db-password)" --yes
   ```
   `--yes` is the CLI's way of taking the yes the person gave you; without it the command stops with `HostedMutationConsentRequiredError`.
   The CLI takes the password only as a flag, so for the moment the command runs other users of this machine could see it; on a shared machine, ask the person to create the project in the Supabase dashboard instead and treat it as an existing one. Note the project ref the command prints, and wait until `pnpm supabase projects list` shows the project as `ACTIVE_HEALTHY`.

   **An existing project:** ask the person to write `DATABASE_URL=…` into `.env` themselves (`cp .env.example .env` first if there is none): the session pooler string from the project's "Connect" dialog, port 5432, with the database password in it. Skip point 4.
3. Link the project: `pnpm supabase link --project-ref <project ref>`. If it asks for the database password, leave it blank: the CLI signs in with your login.
4. For a new project, write the connection string into `.env`, without printing it. The session pooler's host is in `supabase/.temp/pooler-url` after the link; the port has to be 5432 (6543 is the transaction pooler, which Logbook can't use):
   ```bash
   [ -f .env ] || cp .env.example .env
   node -e '
     const fs = require("fs");
     const ref = process.argv[1];
     const password = fs.existsSync(".db-password") ? fs.readFileSync(".db-password", "utf8").trim() : "";
     const host = (fs.readFileSync("supabase/.temp/pooler-url", "utf8").match(/@([^:\/]+)/) || [])[1] || "";
     if (!password) throw new Error(".db-password is missing or empty");
     if (!/pooler\.supabase\.com$/.test(host)) throw new Error("no pooler host in supabase/.temp/pooler-url");
     const url = `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${host}:5432/postgres`;
     const env = fs.readFileSync(".env", "utf8");
     fs.writeFileSync(".env", /^DATABASE_URL=.*$/m.test(env) ? env.replace(/^DATABASE_URL=.*$/m, () => `DATABASE_URL=${url}`) : `${env}\nDATABASE_URL=${url}\n`);
   ' <project ref> && chmod 600 .env && rm .db-password
   ```
   If it stops for the pooler host, ask the person for the session pooler's host from the project's "Connect" dialog (a host name is not a secret) and write it into `supabase/.temp/pooler-url` as `x@<host>:5432`.
5. Apply the migrations (ask first, rule 2; show the dry run's list):
   ```bash
   pnpm supabase db push --remote --dry-run
   pnpm supabase db push --remote --yes
   ```
6. The key that encrypts Slack's tokens in the database, made and written without showing it:
   ```bash
   KEY="$(openssl rand -base64 32)" node -e '
     const fs = require("fs");
     const env = fs.readFileSync(".env", "utf8");
     const line = `SLACK_TOKEN_ENCRYPTION_KEY=${process.env.KEY}`;
     if (/^SLACK_TOKEN_ENCRYPTION_KEY=.+$/m.test(env)) process.exit(0);
     fs.writeFileSync(".env", /^SLACK_TOKEN_ENCRYPTION_KEY=$/m.test(env) ? env.replace(/^SLACK_TOKEN_ENCRYPTION_KEY=$/m, () => line) : `${env}\n${line}\n`);
   '
   ```
   It leaves a key that is already there alone: a new key would make every stored token unreadable.

Check: `pnpm checkup database` shows the connection, the migrations and the API access as `✓`. A `!` on the round trip is expected from a laptop; it matters where Logbook will run.

## 4. The place and the domain

The Slack app needs the domain, so settle it now. The steps of each place are at https://dvovna.github.io/logbook/docs/self-hosting/hosting/ and in the files of `deploy/`.

- **A server of theirs:** the domain they gave. Its DNS has to point at the server before step 6; ask them to confirm.
- **Fly.io** (ask first, rule 2). `fly launch` rewrites the configuration it is given, so give it a copy that git doesn't track:
  ```bash
  cp deploy/fly.toml fly.toml && echo fly.toml >> .git/info/exclude
  fly launch --copy-config --no-deploy --yes --name <app name> --region <the database's region, by the table of step 1>
  ```
  Add `--org <organization>` when the person named one; without it Fly takes their personal organization. The domain is `<app name>.fly.dev`. `fly.toml` in the folder is now the app's configuration, and the `fly` commands below read it.
- **Render:** agree on a service name, set `name` and `region` in `deploy/render.yaml`, and push that change to the person's fork (ask first: `git checkout -b deploy && git commit -am "Render service" && git push origin deploy`). The person creates the Blueprint from that branch in step 6. The domain is usually `<service name>.onrender.com`, but Render adds a suffix when the name is taken: if the dashboard shows another address in step 6, run `pnpm slack:app update --domain <that address>` afterwards.
- **A trial on this machine:** ask the person to start a tunnel to port 3000 (`ngrok http 3000`) and tell you its domain. A free tunnel gets a new domain on every start; `pnpm slack:app update --domain <new domain>` then brings the Slack app and `.env` to it.

## 5. The Slack app

The command creates the app from `slack-app-manifest.yml` through Slack's API and writes the app's ID, client ID, both secrets and the redirect URI into `.env`. It needs an app configuration token, which only the person can make.

Ask the person to do this in their own terminal, in the `logbook` folder (rule 1: the token is a secret, and the command asks for it without showing it):

1. Open https://api.slack.com/apps, and under "Your App Configuration Tokens" click "Generate Token" for the workspace. Copy the **access token**, which starts with `xoxe.xoxp-`, not the refresh token (`xoxe-`).
2. In the `logbook` folder, with Node 26 (`nvm use 26` if they use nvm), run `pnpm slack:app create --domain <the domain of step 4>` once, and paste the token when it asks. Give them the whole command with the domain filled in.

It prints "Created the Slack app" and the app's ID. If it says the token is wrong or expired, they copied the refresh token or an old one: a new token, and again. If they say it failed, look before you ask them to repeat it (rule 7): a second run after a success would only say that `.env` already names an app.

Check: `pnpm checkup env` shows `✓ Configuration`, which means the app exists and its values are in `.env`. If it names a variable, fix that one.

## 6. Run it

- **A server of theirs:** copy `docker-compose.yml`, `deploy/docker-compose.https.yml` and `.env` to the server (keep the `deploy/` folder), add `LOGBOOK_DOMAIN=<domain>` to the `.env` there, and run `docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d`. Copy `.env` with `scp`, never through the chat. If you can't reach the server, give the person these commands to run there.
- **Fly.io:**
  ```bash
  grep -vE '^(#|$|PORT=|[A-Z_]+=$)' .env | fly secrets import
  fly deploy --ha=false
  ```
  The deploy starts the machine Fly charges for and puts the site online: ask first (rule 2). If it answers `422` with "Add a credit card", the person adds one in Fly's dashboard under Billing, and you deploy again.
- **Render:** the person opens the dashboard, chooses New → Blueprint, picks their fork and its `deploy` branch, gives `deploy/render.yaml` as the Blueprint path, then copies the six values Render asks for from `.env` themselves.
- **A trial on this machine:** `docker run -d --name logbook --restart always --stop-timeout 30 --env-file .env -p 3000:3000 ghcr.io/dvovna/logbook:latest`.

Check: `pnpm checkup` shows `✓` for the configuration, the database and "Logbook from outside". The Slack app check is skipped without a token; that is fine. If "Logbook from outside" fails, read the app's logs (`docker logs logbook`, `fly logs`) before changing anything.

## 7. Install it in the workspace

Two things for the person to do in their browser, in this order:

1. **Verify the events URL.** The Slack app was created before Logbook ran, so Slack could not reach its events URL and holds it as unverified; an install then ends on a Slack page that says "There's been a glitch". They open `https://api.slack.com/apps/<app ID>/event-subscriptions` (the ID is `SLACK_APP_ID` in `.env`; an app ID is not a secret) and click **Retry** next to the Request URL until it says **Verified**. If the page shows it as verified already, nothing to do.
2. **Install.** They open `https://<domain>/api/slack/install`, signed in to the workspace the app is for, and approve it. Only this link works (rule 3).

Check: ask them to open Logbook under Apps in Slack. Its Home tab shows a setup checklist, and they got a welcome message. The app's logs show `GET /api/slack/oauth/redirect` and then `POST /api/slack/events`.

If it didn't work, read the logs (`fly logs`, `docker logs logbook`) for what reached Logbook:

- `GET /api/slack/install` and nothing after it: Slack stopped on its own page. The events URL is not verified (point 1), or the browser is signed in to another workspace.
- `GET /api/slack/oauth/redirect` answered with an error page: the link was opened more than 10 minutes ago, or in another browser. They open it again.
- "This Logbook server does not accept installs from your Slack workspace": `ALLOWED_SLACK_TEAM_IDS` in `.env` leaves this workspace out.

## 8. Tell the person what you did

Finish with a short report, without any secret in it:

- the version installed, where it runs and its domain;
- the Supabase project (name and ref) and its region;
- the Slack app's ID;
- that `.env` in the `logbook` folder holds every secret, that it must not be committed, and that `SLACK_TOKEN_ENCRYPTION_KEY` has to be kept safe: without it every workspace has to install the app again;
- what is next for them in Slack: https://dvovna.github.io/logbook/docs/getting-started/set-up-your-workspace/
- how to update later: https://dvovna.github.io/logbook/docs/self-hosting/update/

## Updating an install

When the person asks you to update Logbook instead:

1. In the `logbook` folder: `git fetch --tags && git checkout "$(git tag --list 'v*' --sort=-v:refname | head -1)" && pnpm install`. If git refuses because `deploy/fly.toml` was changed (an install from before `fly.toml` was copied), keep the change as the app's configuration first: `cp deploy/fly.toml fly.toml && echo fly.toml >> .git/info/exclude && git checkout -- deploy/fly.toml`.
2. Read the new version's section of `CHANGELOG.md` and every version's between, and tell the person its "Update step".
3. Migrations before the new version starts (ask first, rule 2): `pnpm supabase db push --remote --dry-run`, then without `--dry-run`. Check: `pnpm checkup database`.
4. When the update step names the Slack app manifest: the person runs `pnpm slack:app update --domain <domain>` in their terminal with a new configuration token. If it says the scopes changed and the changelog says a scope was added, they install the app again at `https://<domain>/api/slack/install`.
5. Start the new version where it runs (`docker compose … pull` and `up -d`, `fly deploy`, or a Blueprint sync). Check: `pnpm checkup`.
