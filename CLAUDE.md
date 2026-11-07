# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Logbook, a multi-tenant Slack app (NestJS 11, TypeScript) for vacation requests and time tracking: users request time off from the bot's App Home, the request goes through an approval workflow, and admins/HR manage users, teams, policies and holidays. Data lives in Supabase (Postgres).

## Commands

```bash
yarn install
yarn start:dev        # watch mode
yarn start:debug      # watch + inspector
yarn build            # nest build -> dist/
yarn start:prod       # node dist/main
yarn lint             # eslint with --fix, formatting included (see note below)
yarn format           # prettier on src and test
npx tsc --noEmit      # type-check only
yarn test             # jest
yarn test src/request-workflows/services/request-workflow.service.spec.ts   # one file
yarn test -t 'finishes the workflow'                                        # by test name
yarn test:int         # integration tests against the local Supabase stack
yarn db:init          # recreate the local Supabase database from supabase/migrations
yarn db:types         # regenerate src/common/types/database.types.ts from the local database
yarn supabase start                                                    # local Supabase in Docker
yarn slack:event src/commands/slack-events/team-join.json --team T0123ABCD   # signed event to the local app
```

- Tests are `*.spec.ts` files next to the code (rootDir `src`, config in `jest.config.ts`). They build services directly with `jest.fn()` mocks rather than through a Nest testing module. `jest.config.ts` pins `TZ=UTC`, because the date code mixes local `getDay()` with `toISOString()` and production runs in UTC.
- Integration tests are `test/integration/*.int-spec.ts` (config in `jest.integration.config.ts`, details in README → "Integration tests"):
  - They build the real `AppModule` through `configureApp` (`src/app.setup.ts`, shared with `main.ts`) and replace only `SlackApiClient` with `FakeSlackApiClient`, which records every Slack call.
  - `SlackTestClient` sends signed events, slash commands, interactions and external select suggestions (`suggest`). Every request fails when the app answers after 2.5 s (Slack gives up after 3). `submitView` builds `view.state.values` from the modal the app opened, so a form field that doesn't match its parser fails the test. Fields the test leaves out keep their initial value, as when the user doesn't touch them.
  - The fake refuses, like Slack, views and messages Slack would not accept (unknown fields, limits, an `initial_option` that is not among the options, duplicate `block_id`s; `support/block-kit-rules.ts`). The same rules check the views the app answers interactions with, and `response_action: errors` may only name input blocks of the submitted view. Any such problem fails the test after it ran.
  - Read App Home tabs and modals with `support/tab-readers.ts` (`listItems`, `titlesOf`, `sectionTexts`, `modalError`, `actionIdsOf`, `buttonText`, `totalCount`) and compare whole values; a substring search in the view's JSON also matches titles and labels.
  - A known, unfixed bug stays as an `it.failing` test with a `BUG:` comment pointing at the code; when the bug is fixed the test fails, and it becomes a plain `it`.
  - Every test works in its own `TestWorkspace` (random `T…` ID, deleted with a cascade at the end).
  - Each test app keeps its jobs in its own pg-boss schema (`pgboss_test_…`, dropped on close) with no poller. `t.slackApi.failNext('chat.postMessage' | 'chat.update')` makes Slack fail the next call; `await t.retryJobs()` runs the jobs waiting for a retry now (`test/integration/job-retries.int-spec.ts`).
  - Every test starts at `TEST_NOW` (Wednesday 2026-06-17, `support/clock.ts`): only `Date` is faked, for the tests and the app in the same process, and the clock keeps running. `travelTo('YYYY-MM-DD')` moves it within a test.
  - `global-setup.ts` reads the URLs and keys from `supabase status` and refuses non-local URLs. It also stops when the local database lacks a migration from `supabase/migrations`.
  - Most effects happen after Slack's acknowledgement (event handlers, EventEmitter listeners, tab updates). `await t.idle()` waits until that work is done, then assert. It works because the app runs such work through `runInBackground` (`src/common/utils/run-in-background.ts`) or `JobsService.run`, and `EventTrackingService` counts what event listeners do as background work too. Work after `res.send()` that skips all three is invisible to it.
- `yarn db:init` runs `supabase db reset` against the local stack, which drops the local database and applies `supabase/migrations`. `src/commands` holds dev scripts and is excluded from `nest build`.
- Prettier (`.prettierrc`) owns formatting, and ESLint reports what Prettier would change (`prettier/prettier`, through `eslint-plugin-prettier` at the end of `eslint.config.mjs`). Don't add ESLint formatting rules such as `indent` or `quotes`: they fight Prettier. The codebase is lint-clean and CI fails on any lint error. The commit that formatted everything is in `.git-blame-ignore-revs` (GitHub skips it in blame; locally run `git config blame.ignoreRevsFile ':(optional).git-blame-ignore-revs'`; without `:(optional)` blame fails in a checkout or worktree whose branch predates the file).
- Node 26 everywhere:
  - pinned in `.nvmrc`;
  - used by the Dockerfile and by CI (`.github/workflows/ci.yml`: tsc, jest, build, lint).

  Node images and installs from 26 on have no yarn and no corepack, so the Dockerfile and CI install `yarn@1.22.22` themselves.
- The app validates env vars with zod (`src/env.schema.ts`) at startup and **exits** if a required one is missing. Only the Supabase URL and service role key, the four Slack values and `SLACK_TOKEN_ENCRYPTION_KEY` (32 bytes, base64) are required; the `MAX_*`/year limits have defaults. `DATABASE_URL` (a direct Postgres connection, on Supabase the session pooler on port 5432) is optional and turns on job retries. Copy `.env.example` to `.env` first.
- Local setup is in README → "Development"; self-hosting is in README → "Self-hosting":
  - Local Supabase from `supabase/config.toml`. Only Postgres, the API, auth and Studio are enabled. Auth is unused by the app but the CLI prints the API keys only with it on.
  - A dev Slack app from `slack-app-manifest.yml` (`APP_DOMAIN` replaced with the ngrok domain), reached through ngrok.
  - Install the dev app by opening `/api/slack/install`, not with the "Install to Workspace" button: only the OAuth redirect creates the `slack_teams` row, and it accepts only a `state` that `/install` set in a cookie.
- `yarn slack:event <payload.json> [--team <T-id>] [--url <url>]` (`src/commands/send-slack-event.ts`) signs a payload with `SLACK_SIGN_IN_SECRET` and posts it to `/api/slack/events`. Use it to exercise event handlers without Slack. Samples in `src/commands/slack-events/` use `T_LOCAL` as the workspace ID, which `--team` replaces.

## Conventions enforced by lint/config

- Interfaces must be prefixed with `I` (`@typescript-eslint/naming-convention` reports an error otherwise).
- Every class member needs an explicit `public`/`private`/`protected` (`explicit-member-accessibility`).
- Single quotes, trailing commas and 2-space indent come from Prettier; `yarn lint` or `yarn format` applies them.
- Imports use the tsconfig path aliases `@modules/<module>/...` and `@common/...`. Absolute `src/...` paths also resolve (`baseUrl: ./`), but relative `../` imports are a lint error. Jest maps all of them in `moduleNameMapper`.
- Domain and shared code (the domain modules, the domain folders of `request-workflows`, `src/common`, `slack-communication`) must not import the Slack UI in `src/slack` (`import/no-restricted-paths`). What both need goes into the domain module or `src/common`, e.g. `TimeEntryStatus` lives in `src/time-entries/enums`. A domain change that people should hear about publishes an event, and a listener in `src/slack` sends the messages.
- `src/common/types/database.types.ts` is the generated Supabase `Database` type. ESLint ignores it; `yarn db:types` formats it with Prettier.

## Schema

The schema lives in `supabase/migrations`:
- `20260101000000_baseline_schema.sql` is the baseline. It holds every public table, constraint, index, comment and RLS flag of the dev project, taken with `pg_dump --schema-only` and made idempotent. On a database that already has the schema it is a no-op. On an empty one it creates the tables that the later migrations rely on.
- The later migrations add RPCs (`get_projects_list`, `assign_project_assignments`, `get_user_projects`, `get_time_entries_list`) and constraints.
- `src/common/types/database.types.ts` is generated from the local database by `yarn db:types`, with the Supabase CLI pinned in `devDependencies` (another CLI version writes the file differently). CI applies `supabase/migrations` to a fresh stack, regenerates the file and fails when it differs from the committed one. Run the CLI as `yarn supabase …` (or `npx supabase …`), never `supabase@latest`: scripts, CI and the integration tests all use the pinned one. Dependabot bumps it in a PR of its own; commit the regenerated file with it.

To change the schema:
1. Add a new migration (`yarn supabase migration new <name>`). The app refuses to start on a database that lacks a migration it ships (`MigrationsCheckService`, through the RPC `applied_migrations`), and the Docker image copies `supabase/migrations` for that.
2. Apply it locally (`yarn db:init`) and run `yarn db:types`. A database with migrations from other branches gives other types.
3. Update the repository's `mapToViewModel`.

Pushing to the dev project:
- The dev project has every migration applied, the baseline included (it was a no-op there). New migrations go out with `supabase db push --remote` (the project is linked; without `--remote` CLI 3 pushes to the local database). Try `--dry-run` first. A migration older than the newest one on dev needs `--include-all`.
- The direct DB host is IPv6-only. From an IPv4 network, use the session pooler (`aws-1-us-east-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`).
- Any other database that has the schema but not the migration history needs `--include-all` on its first push.

How the tables handle foreign keys:
- Every table has an FK to `slack_teams` with `ON DELETE CASCADE`. Uninstalling the app deletes the `slack_teams` row and relies on this cascade.
- Every table has RLS enabled with no policies, and the `anon`/`authenticated` API roles have no table, sequence or function privileges, including by default for new objects (`20261107100000_lock_down_public_api.sql`). The app uses the service-role key, which bypasses RLS. A new table needs nothing extra. A new or re-created function does: PostgreSQL lets `PUBLIC` execute it, and default privileges set per schema can't take that back, so revoke it from `public, anon, authenticated` and grant it to `service_role` in the same migration (see `20261107130000_rejection_reasons.sql`). Never grant anything to `anon`.

## Architecture

### Multi-tenancy

Each Slack workspace that installs the app gets a `slack_teams` row. There are two different IDs to keep apart:
- `slack_teams.slack_id`: Slack's own `T…` workspace ID.
- `slack_team_id`: the internal UUID, used as the foreign key on every other table.

Every repository query must be scoped by `slackTeamId` / `slack_team_id`; `BaseRepository` throws when one isn't (see Domain layer). The bot token is stored on `slack_teams.slack_token`, encrypted with `SLACK_TOKEN_ENCRYPTION_KEY` (`TokenCipherService`, AES-256-GCM, `v1:` prefix); tokens stored in plain text before that are encrypted at startup and on first read. Every outgoing Slack call goes through `SlackCommunicationService`, which looks up the token per workspace via `AccessTokenService`; the token is cached for 1 day. Installing again updates the token (and clears the cache) and keeps the workspace's data and roles. `SlackApiClient` keeps one `WebClient` per token. `views.open` gets one try with a 2.5 s timeout and fails at once on a rate limit, because its `trigger_id` lives 3 seconds; other calls get 3 quick retries and a 10 s timeout.

### HTTP pipeline for Slack (Slack Bolt's receiver is not used; Bolt is only imported for types)

`@slack/bolt` is a devDependency and is not in the production image. Import only types from it (`import type` or type-only names); a value import crashes the app in production.

1. `main.ts` mounts `slackBodyParserMiddleware` on `/api/slack`. It keeps `req.rawBody` for signature checks, then parses the body as JSON or urlencoded.
2. `SlackPayloadParseMiddleware` (wired in `SlackModule.configure`) unwraps the form field `payload` for `/interactions` and `/options`.
3. Guards run in this order: `SlackSignatureGuard` → `SlackUserGuard` (loads the DB user by Slack user ID into `req.user`) → `SlackActiveUserGuard` → `UserRoleGuard` + `@RequireRoles` (a route behind `UserRoleGuard` without `@RequireRoles` is closed to everyone). An unknown or deactivated user ends in `SlackUserAccessException`, which `SlackUserAccessFilter` answers with 200 and a short explanation the route allows (ephemeral reply, modal update, no options, or a DM for a click): Slack shows any other status as a generic failure.

Controllers are in `src/slack/controllers/`:
- OAuth: `/install` sets a random `state` in a cookie and redirects to Slack. `/oauth/redirect` checks the state against the cookie (OAuth CSRF), then calls `TeamSetupWorkflowService`, which creates the `slack_team` and an admin user and starts a background sync of workspace users.
- Users are looked up by workspace and Slack user ID together (`UsersService.findBySlackId(slackId, slackTeamId)`; unique `(slack_team_id, slack_id)`). On Enterprise Grid the same `U…` exists in several workspaces. The guards take the workspace from the request (`getRequestWorkspaceSlackId`).
- `/vacations` slash command.
- Admin commands.
- Events: home tab opened, `file_shared` (starts the CSV import), `team_join`/`user_change` (user upsert), `app_uninstalled`.
- Interactions.
- Options (external select search).

### Interaction dispatch (the most important pattern)

- Handlers are `@Injectable()` classes decorated with `@SlackHandler({ type, callbackId, allowedRoles })`. `allowedRoles` is required: a handler open to everyone says `ALL_ROLES` (role lists in `src/common/constants/role-groups.ts`).
- `SlackHandlersRegistry` finds them at startup through `DiscoveryService` and keys them by `${type}:${callbackId}`. The app refuses to start on two handlers for one key, a handler with no roles, or a `ViewCallbackId` without a handler (read-only modals are listed in `READ_ONLY_VIEWS`).
- How `callbackId` is resolved:
  - `view_submission`: `view.callback_id`.
  - `block_actions` in an App Home tab or a modal: the view's `callback_id`.
  - `block_actions` in a message: the **`block_id` of the first action**, so actionable blocks in messages use the matching `ViewCallbackId` as their `block_id`.
- Slack takes `action_id`, button values, menu choices and form values from the client: a member can send ones the UI never offered. `callback_id` and `private_metadata` come from the stored view. So every handler and service checks the role and that an ID from the client is the workspace's and the user may use it; hiding a button is not access control (`test/integration/access-control.int-spec.ts`, `object-access.int-spec.ts`).
- `SlackInteractionsService` enforces `allowedRoles` and blocks inactive users before it calls the handler.
- `BaseActionHandler` (for `block_actions`) dispatches on `action_id` through `actionMap`. `BaseAdminTabActionHandler` adds the shared admin navigation actions. Helpers such as `withPagination`, `withMenuAction` and `withButtonAction` unpack action values.
- `BaseModalFormSubmitHandler<Metadata, FormData, Result>` (for `view_submission`):
  - Parses `private_metadata` as JSON.
  - Validates `view.state.values` with a `BaseValuesParser` (a zod schema plus field config), returning field-level errors.
  - Calls `onSubmit`.
  - Maps known domain errors (`ValidationError`, `MaxItemsCountReachedError`, `EntityHasDependenciesError`, `PrimaryEntityDeleteError`, `ForbiddenException`) to a message shown in the modal. Any other error shows a generic message.
  - Build responses with `SlackViewResponseFactory`.
  - A parser reads each field by its config key as the `action_id`, so the view element must use that key as its `action_id`. The integration tests' `submitView` fills forms from the real view and catches a mismatch.
- Slack shows an interaction as failed when the answer takes over 3 seconds. Work that updates several messages or notifies people (deciding workflow steps, "Approve for Approvers") runs after the answer through `runInBackground` (`src/common/utils/run-in-background.ts`), which logs its errors. Checks that can fail run before it, so the modal can still show them. `EventTrackingService` routes `EventEmitter2.emit` through `emitAsync`, so `@OnEvent` and tab navigation listeners count as such work as well. On SIGTERM the app waits up to 8 s for all of it before it closes (`BackgroundWorkShutdownService`; `docker stop` kills after 10). A failing listener is logged and not retried; work that must not be lost is a job (see Background jobs).

To add an interaction:
1. Add a `ViewCallbackId` value (`src/slack/enums/integration-callback-id.enum.ts`).
2. Create the decorated handler with its `allowedRoles`.
3. Register it as a provider in its feature module (otherwise the app does not start).

### App Home "tabs"

The UI is a single App Home view that gets re-published to show different screens (`TabId`: Home, Users, Teams, Holidays, VacationPolicies, VacationRequests, VacationsHistory).

- Each screen lives in `src/slack/tabs/<name>/`, with `handlers/`, `parsers/`, `services/` and `views/` and its own Nest module.
- A tab service extends `BaseTabService`. In `onModuleInit` it subscribes to `TabNavigationService` (EventEmitter2 events named by `TabId`).
- `tabNavigationService.navigate(TabId.X, { user, metadata })` re-renders a tab from anywhere.
- Tab state such as pagination and filters round-trips through the view's `private_metadata`. Modals carry it along as `pageMetadata` so they can re-render the tab after a submit.
- If rendering fails, the user sees `FallbackTabView`; inactive users see `InactiveUserTabView`.
- Who may open which tab is in `TAB_ALLOWED_ROLES` (`src/slack/common/views/data/tab-access.ts`). `BaseTabService.publish` checks it and sends anyone else to Home. Hiding a button is not access control: Slack takes action ids, button values and menu choices from the client. So every handler checks the role (`allowedRoles`) and every service checks the owner. A new tab needs an entry in the map.
- Views are injectable classes that return Block Kit JSON.

### Domain layer

Domain modules: `users`, `teams`, `vacation-policies`, `vacation-requests`, `holidays`, `slack-teams`, `request-workflows`. They follow Repository → Service:

- **Repositories** extend `BaseRepository<Tables['x'], ViewModel>` (`src/common/repositories/base.repository.ts`). It uses the Supabase JS client with the service-role key and does no ORM work. Subclasses set:
  - `tableName`;
  - `relations` (embedded PostgREST selects);
  - `searchableColumns`;
  - `mapToViewModel`.

  Filters are `SupabaseFilter`. A filter value can be a plain value (`eq`) or `{ operator, value }`. A filter value that is `undefined` is left out, so `BaseRepository` refuses any query or insert on a workspace's table without `slack_team_id` (and any query on `slack_teams` without a filter); `workspaceColumn = null` turns this off for `slack_teams` only. Search terms go into PostgREST's `.or()` only quoted (`quoteFilterValue`).

  PostgREST answers a query with at most `max_rows` (1000) rows and doesn't say it cut the rest, so `findMany` reads in pages of 1000 until it has everything. `findOne` returns null only when no row matches, and throws on a failed query or several rows. An empty list in a filter matches no row.
- **Services** take camelCase params and convert them to snake_case filters, usually in a private `getFindQuery`. Services also enforce per-workspace limits from env (`MAX_TEAMS_PER_SLACK_TEAM`, `MAX_POLICIES_PER_SLACK_TEAM`, `MAX_*_REQUESTS_PER_USER`) and throw the domain errors from `src/common/errors/`.
- Only an admin grants or removes the Admin role or deactivates an admin (`assertCanChangeUser`). Nobody approves their own vacation request: requesters are left out of their own approval levels, and `RequestWorkflowService.assertNotOwnRequest` guards the approve paths. A Slack `user_change` can deactivate a user but never reactivates one.
- `slack_teams.slack_token` stays out of `ISlackTeamViewModel`; only `AccessTokenService` reads it, through `SlackTeamsService.findAccessToken`.
- Admin and HR see everyone's people and vacations (`isPeopleAdmin`); a manager only the teams that list them in `manager_approvers` (`TeamsService.findManagedTeamIds`, `scopeTeamFilter`, `assertManagesTeam`), whatever team a filter names. Only the approver of a workflow step, or HR/admin, decides or comments on it (`RequestWorkflowService.assertCanActOnStep`). Members log time only on `get_user_projects` projects. IDs taken from forms (teams, clients, policies, project assignments) are checked to be the workspace's.
- Text people typed (comments, reasons, descriptions, people's names) goes into mrkdwn through `escapeMrkdwn` (`src/slack/common/utils/mrkdwn.utils.ts`), so it can't become a link or a mention.
- Roles (`UserRole`):
  - `admin`: full access;
  - `hr`: manages people and requests;
  - `manager`: approves;
  - `member`.

### Vacation request approval flow (event-driven, EventEmitter2)

1. `VacationRequestsService` emits `vacation_request.created`.
2. `VacationRequestProcessingService` builds the workflow levels from the user's team:
   - level 1: `manager_approvers`;
   - level 2: `hr_approvers`.

   Each level has an `ApprovalRule` of `ANY` or `ALL`. If nobody on the team can approve it (no team, no approvers, or the requester is the only one), it goes as one `ANY` level to everyone with the HR role, else to every admin, never to the requester. The requester gets a DM saying so (`VacationApproversNoticeService`). With nobody else in the workspace, no workflow is created and the DM says the request stays pending.
3. `RequestWorkflowService` stores one row per approver in `vacation_request_workflow_steps` and activates level 1 through `WorkflowStepProcessorService`.
4. Step processors are registered with `@WorkflowStepProcessor(type)` and found by `WorkflowStepProcessorsRegistry` (the same discovery pattern as Slack handlers). The only type is `approver`: `ApproverStepProcessor` sends each approver a DM with Approve / Reject / Comment buttons. `WorkflowStepProcessorService` asks and updates in jobs, one per step; a decided or canceled step is marked `completed_at` first, so a Slack failure never stops the workflow.
5. Button clicks go to `ApproverStepMessageHandler` (`block_id` `workflow_step_message`):
   - `ANY`: one approval completes the level.
   - `ALL`: the level waits until there are no pending steps.
   - A reject at any level ends the workflow.
   - Comments re-render the messages of all pending steps.
   - By design a step is not tied to the user who clicks: HR and admins may decide for an approver who is away, so a request doesn't get stuck. In the UI they do it with "Approve for Approvers" in the Vacation Requests tab (`ApproveVacationRequestOnBehalfHandler` → `RequestWorkflowService.approveCurrentLevel`), which approves every open step of the current level and moves on.
6. When the workflow finishes it emits `VacationWorkflowFinished`. `RequestWorkflowProcessingService` then sets the request status (a job) and publishes `vacation_request.decided`. On the Slack side, `VacationDecisionNotificationsService` (Vacation Requests tab module) notifies the requester and each of the team's `approval_notification_recipients`, one job per message.

Two approvers can click at the same moment, so the transitions are single conditional updates rather than "read, check, write". A decision (approve, reject, cancel, "Approve for Approvers") is the RPC `decide_workflow_steps`: in one `UPDATE` it writes the status into `step_data` and sets `completed_at`, only on steps that are still open, and returns the steps it decided (none when someone else was first, and then the caller stops). `VacationRequestsService.finishPending` changes only a request that is still pending (whoever changes it sends the notifications), and the next level's steps are claimed through `processed_at` (`claimUnprocessed`) before anyone is asked.


### Time & Billing

Domain modules `clients`, `projects`, `time-entries`; Slack tabs `clients`, `projects`, `time-tracking` (Log Time modal, entries list), `time-approvals`, `time-and-billing` (hub, billing report).
- Projects belong to an optional client and are assigned to teams and users (`assign_project_assignments`). People log time on their team's and their own projects (`get_user_projects`). `TIME_ENTRIES_ADMIN_ROLES` (Admin, HR) log for anyone on any active project and see and edit everyone's entries; everyone else sees only their own, and Home → Edit Entries shows only your own for every role.
- An entry takes its client and billability from its project. Minutes come in 15-minute steps, at most 24 hours per user, project and day (also a check constraint).
- Status: the owner logs drafts and submits them; a submitted entry is approved or rejected in the Approvals tab by the managers of its team (`manager_approvers`, as for vacations), HR or an admin, never by its owner. A rejection sends the owner a DM. The owner changes only drafts and rejected entries (a fixed one is a draft again).
- Lists come from `get_time_entries_list`. Billing reports count approved entries of a client's projects for a period.

### Background jobs

`JobsService` (`src/common/jobs/`, pg-boss 10 on `DATABASE_URL`) runs the work that must happen even when Slack or the database fails for a while: starting a vacation workflow, asking approvers, updating their messages, finishing the request, telling people of the decision, and the DM about a rejected time entry.
- A service defines its jobs in `onModuleInit` (`jobs.define(name, handler)`) and starts one with `jobs.run(name, payload)`, which returns at once.
- `run` saves the job, then runs it right away in the same process (tracked as background work). The saved copy is deleted when the run succeeds; otherwise a poller (every 30 s) retries it from 5 minutes on, up to 8 times with growing delays (about 8 hours in all). A job a stopped process never finished is retried too.
- Payloads hold IDs, and handlers load the current data: a retry may come after the request was canceled or the entry fixed, and then does nothing. A handler must be safe to run twice, because a run can fail after it did part of the work (e.g. `WorkflowStepJob.Ask` skips a step that already has a message).
- Without `DATABASE_URL` a job runs once, as before, and the app says so at startup. pg-boss keeps its tables in the `pgboss` schema, which it creates and migrates itself; it is not exposed through the REST API.
- pg-boss 12 is ESM-only, so the project stays on 10.x (CommonJS).

### Other pieces

- **Vacation year and limits** (`VacationsUsageService`):
  - The year runs from the contract start anniversary, or over the calendar year when the user has no contract start date (`vacation-period.utils.ts`).
  - Limits come only from the vacation policy of the user's team. With no policy, `limits` is null: usage is tracked and shown, but no balance is checked. This is the "no setup" mode.
  - Usage is counted from the requests on every read (`VacationPeriodUsageService`), not cached: a cache went stale on CSV imports and holiday or policy changes.
- **Working days:** `VacationDaysCalculationService` excludes weekends and the enabled holidays of the user's vacation policy. Holidays can be imported per country from Nager.Date (`src/holidays/clients/nager-date.client.ts`).
- **CSV imports:** an admin command posts a prompt, the admin uploads a file, Slack sends `file_shared`, and `FileUploadService` routes the file **by its name** to `src/user-data-import/`:
  - `user-vacations.csv` (`/upload-vacations`): sets the contract start date and replaces the user's vacations;
  - `user-team-mapping.csv` (`/user-team-mapping`): `email;team_name` (both CSVs use `;`), moves users to the team with that exact name.
- **Caching:** `CacheModule.register()` is in-memory, so each process has its own cache (access tokens for a day, Nager.Date holidays for an hour; cache-manager takes TTLs in milliseconds). That's fine because production runs a single instance. Running more instances would need a shared store, for example Redis via Keyv.
- **Logging:** `nestjs-pino`, pretty-printed unless `NODE_ENV=production`.
- **Errors:** a request's error is logged and answered in one place, `GlobalExceptionsFilter`. It logs once: client errors (4xx) as warnings, everything else with its stack. The answer gives a client error's own message, and only "Internal server error" otherwise. Don't log and rethrow on the way up. Errors after the answer go through `runInBackground`, which logs them.
- **Deploy:** multi-stage `Dockerfile` (Node 26 alpine, `NODE_ENV=production`, runs as the `node` user, `PORT=10000`; only `dependencies` are installed, so build and lint tools belong in `devDependencies`; `docker-compose.yml` sets `PORT` from `.env`, default 3000). The `public/` folder is served statically; the OAuth flow redirects to `/success.html`.
