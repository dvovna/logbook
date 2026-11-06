## Description

This is a Slack bot app that allows managing user vacation requests.

## Project setup

Node 26 (the version is pinned in `.nvmrc`, so `nvm use` picks it up) and yarn 1.

```bash
$ yarn install
```

## Compile and run the project

```bash
# development
$ yarn run start

# watch mode
$ yarn run start:dev

# production mode
$ yarn run start:prod
```

## Tests

```bash
$ yarn test
$ npx tsc --noEmit
```

## Local development

You need Docker, [ngrok](https://ngrok.com) and a Slack workspace for testing. Don't point a local app at the production database or the production Slack app.

### 1. Database

The app reads and writes through the Supabase API, so a plain Postgres is not enough. `supabase/config.toml` starts a local stack with only Postgres, the API and Studio enabled:

```bash
$ npx supabase@latest start
```

On the first start (and on `npx supabase@latest db reset`) the schema from `src/commands/init.sql` is loaded as a seed. After changing `init.sql`, apply it with `yarn db:init` (it is idempotent) or reset the database.

Copy `.env.example` to `.env` and take the Supabase values from `npx supabase@latest status -o env`:

| `.env`                      | `status -o env`    |
| --------------------------- | ------------------ |
| `SUPABASE_URL`              | `API_URL`          |
| `SUPABASE_KEY`              | `ANON_KEY`         |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` |
| `SUPABASE_DB_URL`           | `DB_URL`           |

Studio is at http://127.0.0.1:54323. `npx supabase@latest stop` stops the stack and keeps the data.

### 2. Slack app

1. Start a tunnel. A static domain (the free ngrok plan has one) keeps the Slack URLs the same between restarts:
   ```bash
   $ ngrok http 3000 --url=<your-domain>
   ```
2. Replace `NGROK_DOMAIN` in `slack-app-manifest.dev.yml` with your domain and create an app from it at https://api.slack.com/apps ("Create New App" → "From a manifest").
3. Copy Client ID, Client Secret and Signing Secret (into `SLACK_SIGN_IN_SECRET`) from "Basic Information" to `.env`, and set `SLACK_REDIRECT_URI=https://<your-domain>/api/slack/oauth/redirect`.
4. Run `yarn start:dev`, then open "Event Subscriptions" in the app settings and retry the URL verification. Slack signs it with the Signing Secret, so the app has to be running with the right one.
5. Install the app through the OAuth URL. Don't use "Install to Workspace" in the app settings: it skips the OAuth redirect, so the workspace is never created in the database.
   ```
   https://slack.com/oauth/v2/authorize?client_id=<client-id>&scope=commands,chat:write,files:read,users:read,users:read.email&redirect_uri=https://<your-domain>/api/slack/oauth/redirect
   ```

The user who installs the app becomes an admin, and the other workspace members are imported in the background. To go through an approval you need at least two people in the workspace: one requests a vacation, the other approves it.

### 3. Sending events without Slack

`yarn slack:event` posts a payload to the running app, signed with `SLACK_SIGN_IN_SECRET` from `.env`, so event handlers can be checked without Slack or ngrok. Sample payloads are in `src/commands/slack-events/`. They use `T_LOCAL` as the workspace ID; `--team` replaces it with the `slack_id` of a workspace from the `slack_teams` table:

```bash
$ yarn slack:event src/commands/slack-events/url-verification.json
$ yarn slack:event src/commands/slack-events/team-join.json --team T0123ABCD
```

`--url` sends the payload somewhere else, e.g. through the tunnel. Handlers that call the Slack API (`app_home_opened`, for example) need a workspace with a valid bot token, i.e. one installed through the OAuth URL above.
