---
title: Install
description: Run your own Logbook, from the database and the Slack app to the first install in a workspace.
sidebar:
  order: 1
---

One deployment of Logbook can serve one Slack workspace or many.

## What you need

- The source of the release you run, for its database migrations. With pnpm 10:
  ```bash
  npm install -g pnpm@10
  git clone --branch v0.3.0 https://github.com/dvovna/logbook && cd logbook && pnpm install
  ```
  The steps below run the Supabase CLI pinned in it.
- A Supabase project. The free plan runs the bot, but it keeps no backups, and Supabase pauses it after a week of little activity (see [Operate](/logbook/docs/self-hosting/operate/#health-check)). For a company's real data, take a paid plan or back the database up yourself (see [Backups](/logbook/docs/self-hosting/operate/#backups)).
- A host that runs Docker or Node 26, reachable from Slack over HTTPS.
- Permission to create a Slack app in your workspace.

## 1. Database

Create a Supabase project and apply the migrations:

```bash
pnpm supabase db push --remote "postgresql://postgres.<project-ref>:<db-password>@<pooler-host>:5432/postgres"
```

Take the session pooler connection string from the project's "Connect" dialog. The direct `db.<project-ref>.supabase.co` host is IPv6-only. Logbook connects with the same string (`DATABASE_URL` below).

Supabase is the tested path. Logbook itself connects only to Postgres and uses none of Supabase's other services, but its migrations grant to and revoke from Supabase's `anon` and `authenticated` roles: another Postgres needs those roles before the migrations apply. At startup Logbook checks the migration history that the Supabase CLI keeps; on a database without it, it logs a warning and skips the check.

:::caution[Run the app in the database's region]
Every SQL statement is a round trip to the database, and a click such as saving a week or approving a request sends up to ten of them one after another before the app answers. A round trip takes about a millisecond within a region and about 100 ms between regions. Far from its database, the app spends up to a second of the 3 that Slack waits on the database alone. See [Operate](/logbook/docs/self-hosting/operate/#run-the-app-next-to-its-database).
:::

## 2. Slack app

1. Replace `APP_DOMAIN` in [`slack-app-manifest.yml`](https://github.com/dvovna/logbook/blob/main/slack-app-manifest.yml) with the domain the bot will run on:
   ```bash
   sed 's/APP_DOMAIN/vacations.example.com/g' slack-app-manifest.yml
   ```
   The command prints the result; copy it, or add `> manifest.yml` to save it.
2. Create the app from the result at https://api.slack.com/apps ("Create New App" → "From a manifest"). The manifest turns on token rotation: bot tokens expire after 12 hours and the app refreshes them, so a token that leaks is soon useless. Slack can't turn rotation off again for an app.
3. To install it into other workspaces too, turn on public distribution in "Manage Distribution", and share `https://<your-domain>/api/slack/install` as the install link (see step 5).

Without public distribution, only your own workspace can install the app, which is what a single company wants. With it, any Slack workspace that has the link can install the app on your server, unless you list the allowed ones in `ALLOWED_SLACK_TEAM_IDS`.

## 3. Configuration

Copy [`.env.example`](https://github.com/dvovna/logbook/blob/main/.env.example) to `.env` and fill it in:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The session pooler connection string from step 1 (port 5432, not 6543). |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app → Basic Information |
| `SLACK_SIGN_IN_SECRET` | Slack app → Basic Information → Signing Secret |
| `SLACK_REDIRECT_URI` | `https://<your-domain>/api/slack/oauth/redirect` |
| `SLACK_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64. Keep it with your other secrets: without it the app can't read the bot tokens, and every workspace has to install the app again. |
| `PORT` | The port to listen on: 3000 in `.env.example`, and 3000 when it's unset, except in the Docker image, which sets 10000. |

Make the encryption key with:

```bash
openssl rand -base64 32
```

The optional settings (allowed workspaces, Sentry, pool sizes, data retention, limits) are in [Configuration](/logbook/docs/reference/configuration/).

## 4. Run

The image is on GitHub Container Registry for amd64 and arm64, tagged with each version (`0.3.0`), its minor line (`0.3`) and `latest`:

```bash
docker run -d --name logbook --restart always --stop-timeout 30 --env-file .env -p 3000:3000 ghcr.io/dvovna/logbook:0.3
```

The second port of `-p` is `PORT` from `.env`. With `PORT` left out of `.env`, the container listens on 10000, so map `-p 3000:10000`.

Or with the compose file, which runs the same image (`LOGBOOK_VERSION` picks the tag, `latest` by default):

```bash
docker compose up -d
```

`docker compose up -d --build` builds the image from your checkout instead. Or without Docker:

```bash
pnpm install
pnpm build
pnpm start:prod
```

Then:

1. Put the app behind HTTPS: a reverse proxy, or a platform such as Render or Fly.io.
2. Set the platform's shutdown grace period to 30 seconds. The compose file and the `docker run` above already do. See [Operate](/logbook/docs/self-hosting/operate/#restarts-and-deploys).
3. Point the platform's health check at `GET /health`. The Docker image already uses it.
4. In the Slack app settings, open "Event Subscriptions" and retry the URL verification.

## 5. Install in a workspace

1. Open `https://<your-domain>/api/slack/install` in the browser.
2. Approve the app.

The link starts the OAuth flow with a one-time `state` bound to your browser, so only an installation started there can finish. It works for 10 minutes.

:::caution
Don't use "Install to Workspace" in the app settings, and don't use the sharable URL Slack generates. Both skip the `state`, so the bot refuses them and the workspace is never created. When you distribute the app, give out the `/api/slack/install` link.
:::

What happens next:
- The person who installs the app becomes its admin and gets a welcome message with the setup steps.
- The other members of the workspace are imported a few seconds later, as Members.
- **Home** shows admins and HR a checklist until the workspace is set up. See [Set up your workspace](/logbook/docs/getting-started/set-up-your-workspace/).

Installing again later (for example after an update adds scopes) only replaces the bot token: data and roles stay as they are.

## An app created from an older manifest

The CSV files Logbook sends need the `files:write` scope, which the manifest got after the first installs. If your Slack app was created from an older manifest:

1. Add `files:write` under "OAuth & Permissions" → "Bot Token Scopes", or update the app from the current manifest.
2. Install the app again in every workspace through `/api/slack/install`.

Until a workspace does, a CSV comes as a message that asks for it.

## Next

- [Update](/logbook/docs/self-hosting/update/) when a new release comes out.
- [Operate](/logbook/docs/self-hosting/operate/): connections, restarts, health, logs, backups.
