---
title: Overview
description: How Logbook is built, in one page, and where to read more before you change it.
sidebar:
  order: 1
---

This page gives you the shape of Logbook's code before you open it. The details live in the repository.

## The pieces

| Piece | What it is |
| --- | --- |
| App | NestJS 11 and TypeScript, one process. It receives Slack's events, slash commands and interactions over HTTPS. Slack's Bolt receiver isn't used. |
| Database | Postgres, on Supabase in the tested setup. The app connects directly over `DATABASE_URL` and queries it with Kysely; Supabase's REST API stays closed. The schema is in `supabase/migrations`. |
| Jobs | pg-boss, on the same database, for the work that must survive a Slack outage or a restart. |
| Slack calls | All outgoing calls go through one service that finds the workspace's bot token, refreshes it when it rotates, and retries. |

## A request from Slack

1. A body parser on `/api/slack` keeps the raw body, then parses JSON or form data.
2. Guards run in order: Slack's signature, the user (looked up by workspace and Slack user ID), the user is active, and on admin routes the role.
3. A controller answers Slack within its 3 seconds. Interactions are dispatched to handler classes registered with `@SlackHandler({ type, callbackId, allowedRoles })`; the app refuses to start when two handlers claim one key or a handler names no roles.
4. Work that takes longer runs after the answer: in memory when losing it on a restart does no harm, or as a job when it must happen.

## App Home tabs

The UI is one App Home view, published again for each screen. A registry lists every screen with its roles, the tab that shows it and where it sits in the navigation. A tab's state (page, filters) travels in the view's metadata. Every handler and service checks the role and that an ID from the client belongs to the workspace, because Slack takes action IDs and values from the client.

## Domain, events and transactions

- Domain modules (users, teams, vacation requests, request workflows, projects, time entries, billing and others) go Repository → Service. Every query is scoped to one workspace; the base repository refuses one that isn't.
- The Slack UI uses the domain modules, never the other way round, and a lint rule keeps it so. A domain change that people should hear about publishes an event, and a listener on the Slack side sends the messages.
- Writes that belong together run in one transaction. Events emitted inside reach their listeners after the commit, and jobs saved inside run after it, so a change never commits without the work that follows it. Decisions that two people can make at once take an advisory lock and update only what is still open.

## Where to read more

- [README → Development](https://github.com/dvovna/logbook/blob/development/README.md#development): the local Supabase stack, a dev Slack app through ngrok, and sending signed events without Slack.
- [CONTRIBUTING.md](https://github.com/dvovna/logbook/blob/development/CONTRIBUTING.md): how to make a change, the checks it must pass, and how to release.
- [CLAUDE.md](https://github.com/dvovna/logbook/blob/development/CLAUDE.md): the architecture and the patterns in depth: interaction dispatch, tabs, the approval workflow, transactions, jobs, time and billing.
- `test/integration`: tests that run the whole app against the local database with a fake Slack, which refuses what the real Slack would refuse. They show how each feature is used.
- `test/load` (`pnpm test:load`): the Monday peak of a 400-person company, to check that answers stay within Slack's 3 seconds.

Branch from `development`; `main` holds the releases.
