---
title: Install with an AI agent
description: Paste one prompt into an AI coding agent, and it sets up the database, the Slack app and the run, asking you only for what a person has to decide.
sidebar:
  order: 2
---

An AI coding agent, such as Claude Code, can do most of [Install](/logbook/docs/self-hosting/install/) for you. Open it in an empty folder on your machine and paste this:

```text
Install Logbook for me. Follow the instructions at
https://dvovna.github.io/logbook/docs/agent-install.md exactly, in order.
Ask me before anything that costs money or can't be undone,
and never show a secret in this chat.
```

The address in the prompt is a page written for the agent: the steps of Install, a check after each one, and the rules it has to keep. You can read it at [agent-install.md](/logbook/docs/agent-install.md).

## What the agent does

1. Asks where Logbook should run, which Supabase project or region, and which Slack workspace.
2. Gets the source of the latest release and its tools.
3. Creates the Supabase project, or uses yours, applies the migrations, and writes the connection string and the encryption key into `.env`.
4. Settles the domain with you, by the place you chose: your server, Fly.io, Render, or your machine for a trial. See [Where to run it](/logbook/docs/self-hosting/hosting/).
5. Has you create the Slack app with one command, then starts Logbook.
6. Runs `pnpm checkup` after each step and fixes what it reports.
7. Ends with a report of what it made and where.

## What stays with you

- **Sign-ins.** You sign in to the Supabase CLI, and to Fly.io if you use it, in your own terminal.
- **The Slack app's token.** You generate an app configuration token at https://api.slack.com/apps and paste it into the command yourself. It lasts 12 hours and never goes through the chat.
- **Every yes.** The agent asks before it creates a project, applies migrations, or creates anything on a hosting platform.
- **The install in Slack.** You open `https://<your-domain>/api/slack/install` in your browser and approve the app.

## Secrets

The agent is told to keep secrets out of the chat: the database password, the connection string, Slack's secrets and the encryption key go from the tool that makes them into `.env`, and the checks name variables without showing values. Keep `.env` out of version control, and keep `SLACK_TOKEN_ENCRYPTION_KEY` safe: without it every workspace has to install the app again.

An agent can still make mistakes. Read what it is about to do when it asks, and look at its final report.

## Update with an agent

The same page covers updates. In the folder of your install:

```text
Update my Logbook to the latest release. Follow the "Updating an install"
section of https://dvovna.github.io/logbook/docs/agent-install.md exactly.
Ask me before applying migrations, and never show a secret in this chat.
```
