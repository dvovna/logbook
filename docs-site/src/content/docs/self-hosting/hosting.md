---
title: Where to run it
description: 'Three ways to run Logbook behind HTTPS: Docker on your own server, Fly.io and Render, each with a ready configuration.'
sidebar:
  order: 2
---

Logbook needs a place that runs one container, answers Slack over HTTPS, and gives it 30 seconds to stop. The repository's `deploy/` folder has a configuration for each of the three below. Do steps 1 to 3 of [Install](/logbook/docs/self-hosting/install/) first: the database, the Slack app and `.env`.

Whichever you pick:

- Run it in the region of your database. A click sends several statements one after another, and each is a round trip.
- Run one instance.
- The domain you end up with is the one in `SLACK_REDIRECT_URI` and in the Slack app. If it differs from the one you created the app for, bring both to it: `pnpm slack:app update --domain <domain>`.
- Afterwards, `pnpm checkup` says whether Slack can reach the app. See [Check an install](/logbook/docs/self-hosting/operate/#check-an-install).

## Docker on your own server

You need a server with Docker, a domain whose DNS points at it, and ports 80 and 443 open. Caddy gets the HTTPS certificate and renews it.

1. Copy `docker-compose.yml`, `deploy/docker-compose.https.yml` and your `.env` to the server, keeping the `deploy/` folder.
2. Add the domain to `.env`:
   ```
   LOGBOOK_DOMAIN=logbook.example.com
   ```
3. Start both containers:
   ```bash
   docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml up -d
   ```
4. Check it from anywhere:
   ```bash
   curl https://logbook.example.com/health
   ```
   It answers `{"status":"ok"}`. The first request may take a few seconds while Caddy gets the certificate.

To update, set `LOGBOOK_VERSION` in `.env` if you pin one, then run `docker compose -f docker-compose.yml -f deploy/docker-compose.https.yml pull` and the `up -d` command again.

## Fly.io

You need the [`fly` CLI](https://fly.io/docs/flyctl/install/), signed in.

1. From the repository's root, create the app from the configuration. It asks for a name and a region; pick the region of your database:
   ```bash
   fly launch --config deploy/fly.toml --copy-config --no-deploy
   ```
2. Your domain is `<app-name>.fly.dev`. Put it into `.env` and the Slack app:
   ```bash
   pnpm slack:app update --domain <app-name>.fly.dev
   ```
3. Give Fly the values of `.env` as secrets, and deploy one machine. `PORT` stays out: the configuration sets the port the machine listens on.
   ```bash
   grep -vE '^(#|$|PORT=)' .env | fly secrets import --config deploy/fly.toml
   fly deploy --config deploy/fly.toml --ha=false
   ```
4. Check it:
   ```bash
   curl https://<app-name>.fly.dev/health
   ```

`deploy/fly.toml` keeps one machine always on, checks `/health`, and sets `kill_timeout` to 30 seconds. To update, change the image tag in it if you pin a version, and run `fly deploy` again.

## Render

You need a Render account and a fork of the repository, since a Blueprint is read from a repository of yours.

1. In the Render dashboard choose **New** → **Blueprint**, pick your fork, and give `deploy/render.yaml` as the Blueprint path.
2. Render asks for the six values marked in the file: `DATABASE_URL`, the four Slack values and `SLACK_TOKEN_ENCRYPTION_KEY`. Copy them from `.env`. For `SLACK_REDIRECT_URI`, use the address Render gives the service: `https://<service>.onrender.com/api/slack/oauth/redirect`.
3. Bring the Slack app to that address:
   ```bash
   pnpm slack:app update --domain <service>.onrender.com
   ```
4. Check it:
   ```bash
   curl https://<service>.onrender.com/health
   ```

`deploy/render.yaml` runs one instance of the published image, checks `/health`, and sets `maxShutdownDelaySeconds` to 30. Change `region` in it to the one next to your database before you create the Blueprint. To update, change the image tag and sync the Blueprint.

:::note
The Fly.io and Render configurations are new. If a step differs from what you see, [open an issue](https://github.com/dvovna/logbook/issues).
:::
