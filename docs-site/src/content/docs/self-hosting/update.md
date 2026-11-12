---
title: Update
description: Move your Logbook to a new release, with its database migrations and any step the release needs.
sidebar:
  order: 4
---

Most updates are a new image and the release's database migrations. Before 1.0, a minor version (0.5 to 0.6) may need a step of its own.

## Find the release's update step

Every release has a section in [CHANGELOG.md](https://github.com/dvovna/logbook/blob/main/CHANGELOG.md), and the same text on its [GitHub release](https://github.com/dvovna/logbook/releases). When a release needs something besides the new image, its section says so under **Running it**, in a line that starts with **Update step**: the migrations it adds, and whether to apply the Slack app manifest again.

| Release | Update step |
| --- | --- |
| 0.1.0 | The first release. |
| 0.2.0 | Two database migrations. |
| 0.3.0 | Six database migrations, and the Slack app manifest again (it drops `/user-team-mapping`). |
| 0.4.0 | Three database migrations, and the Slack app manifest again (it drops `/upload-vacations`). |
| 0.4.1 | None: only the new image. |
| 0.5.0 | None: only the new image. |
| 0.5.1 | None: only the new image. |

When you skip releases, take the steps of every release in between. The migrations of all of them apply in one push.

## Update

1. Read the new version's section in the changelog.
2. Check out the new release's tag in your copy of the source, and install its tools:
   ```bash
   git fetch --tags
   git checkout v0.5.1
   pnpm install
   ```
   Use the tag of the version you update to.
3. Apply the new migrations, with the same connection string as at install:
   ```bash
   pnpm supabase db push --remote "<the same connection string>"
   ```
   Without `--remote`, the CLI pushes to a local database. Add `--dry-run` first to see which migrations it would apply.
4. When the changelog says so, apply the Slack app manifest again (below).
5. Run the new image. With the compose file, set `LOGBOOK_VERSION` to the new version if you pin one, then:
   ```bash
   docker compose pull && docker compose up -d
   ```
   With `docker run`, pull the new tag, stop and remove the old container, and start it again with the same command as at [install](/logbook/docs/self-hosting/install/#4-run):
   ```bash
   docker pull ghcr.io/dvovna/logbook:0.5
   docker stop logbook && docker rm logbook
   ```

`pnpm checkup database` in the new release's source says whether its migrations are applied, before you start the new image.

Apply the migrations before the new version starts. It checks the database at startup and refuses to start, naming the missing migrations, until they are applied:

```text
The database lacks 2 migration(s) this version needs: 20261110171144, 20261111100000. Apply them with `pnpm supabase db push --remote "<connection string>"` (locally `pnpm supabase migration up`), then start the app again.
```

:::tip
An image tagged with a minor line, such as `0.5`, gets that line's patch releases with `docker compose pull` or `docker pull`. A new minor version needs the new tag, and may need a step.
:::

## Apply the Slack app manifest again

When a release changes the commands, scopes or events Slack sends:

1. Generate an app configuration token at https://api.slack.com/apps, as at [install](/logbook/docs/self-hosting/install/#2-slack-app).
2. In the new release's source, bring the app to its manifest:
   ```bash
   pnpm slack:app update --domain vacations.example.com
   ```
   It takes the app from `SLACK_APP_ID` in `.env` (or `--app <app id>`, which is in the app's address at https://api.slack.com/apps) and keeps the app's name and description. By hand instead: replace `APP_DOMAIN` in `slack-app-manifest.yml` with your domain, open your app's "App Manifest", paste the result over the current manifest, and save.
3. When the release adds scopes, install the app again in every workspace through `https://<your-domain>/api/slack/install`. Data and roles stay as they are.

## Turn on token rotation for an older app

An app created before token rotation keeps working with its tokens, which never expire. To switch to rotating tokens:

1. Turn on "Advanced token security via token rotation" under "OAuth & Permissions".
2. Install the app again in each workspace through `/api/slack/install`. The new install gets a rotating token.

## Check the database is closed

Logbook reaches the database only through `DATABASE_URL`. The `anon` and `authenticated` roles of the Supabase API get no access to its tables and functions. After changing the schema outside the migrations (for example in Supabase Studio), check that this still holds. Every query should return no rows:

```sql
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC');
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute')
   or has_function_privilege('authenticated', p.oid, 'execute'));
```

The first lists tables without row-level security, the second table privileges of the API roles, the third functions they may run.
