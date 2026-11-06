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
yarn lint             # eslint with --fix on all of src (see note below)
yarn format           # prettier
npx tsc --noEmit      # type-check only
yarn test             # jest
yarn test src/request-workflows/services/request-workflow.service.spec.ts   # one file
yarn test -t 'finishes the workflow'                                        # by test name
yarn test:int         # integration tests against the local Supabase stack
yarn db:init          # recreate the local Supabase database from supabase/migrations
npx supabase@latest start                                                    # local Supabase in Docker
yarn slack:event src/commands/slack-events/team-join.json --team T0123ABCD   # signed event to the local app
```

- Tests are `*.spec.ts` files next to the code (rootDir `src`, config in `jest.config.ts`). They build services directly with `jest.fn()` mocks rather than through a Nest testing module. `jest.config.ts` pins `TZ=UTC`, because the date code mixes local `getDay()` with `toISOString()` and production runs in UTC.
- Integration tests are `test/integration/*.int-spec.ts` (config in `jest.integration.config.ts`, details in README → "Integration tests"):
  - They build the real `AppModule` through `configureApp` (`src/app.setup.ts`, shared with `main.ts`) and replace only `SlackApiClient` with `FakeSlackApiClient`, which records every Slack call.
  - `SlackTestClient` sends signed events, slash commands, interactions and external select suggestions (`suggest`). `submitView` builds `view.state.values` from the modal the app opened, so a form field that doesn't match its parser fails the test. Fields the test leaves out keep their initial value, as when the user doesn't touch them.
  - A known, unfixed bug stays as an `it.failing` test with a `BUG:` comment pointing at the code; when the bug is fixed the test fails, and it becomes a plain `it`.
  - Every test works in its own `TestWorkspace` (random `T…` ID, deleted with a cascade at the end).
  - `global-setup.ts` reads the URLs and keys from `supabase status` and refuses non-local URLs. It also stops when the local database lacks a migration from `supabase/migrations`.
  - Most effects happen after Slack's acknowledgement (event handlers, EventEmitter listeners), so assert with `eventually(...)`.
- `yarn db:init` runs `supabase db reset` against the local stack, which drops the local database and applies `supabase/migrations`. `src/commands` holds dev scripts and is excluded from `nest build`.
- The codebase is not lint-clean: about 140 prettier and other errors already exist. `yarn lint` uses `--fix`, so it rewrites many unrelated files. To lint only what you touched, run `npx eslint <files>`.
- Node 26 everywhere:
  - pinned in `.nvmrc`;
  - used by the Dockerfile and by CI (`.github/workflows/ci.yml`: tsc, jest, build, non-blocking lint of changed files).

  Node images and installs from 26 on have no yarn and no corepack, so the Dockerfile and CI install `yarn@1.22.22` themselves.
- The app validates env vars with zod (`src/env.schema.ts`) at startup and **exits** if a required one is missing. Only the Supabase URL and service role key and the four Slack values are required; the `MAX_*`/year limits have defaults. Copy `.env.example` to `.env` first.
- Local setup is in README → "Development"; self-hosting is in README → "Self-hosting":
  - Local Supabase from `supabase/config.toml`. Only Postgres, the API, auth and Studio are enabled. Auth is unused by the app but the CLI prints the API keys only with it on.
  - A dev Slack app from `slack-app-manifest.yml` (`APP_DOMAIN` replaced with the ngrok domain), reached through ngrok.
  - Install the dev app through the OAuth URL, not the "Install to Workspace" button: only the OAuth redirect creates the `slack_teams` row.
- `yarn slack:event <payload.json> [--team <T-id>] [--url <url>]` (`src/commands/send-slack-event.ts`) signs a payload with `SLACK_SIGN_IN_SECRET` and posts it to `/api/slack/events`. Use it to exercise event handlers without Slack. Samples in `src/commands/slack-events/` use `T_LOCAL` as the workspace ID, which `--team` replaces.

## Conventions enforced by lint/config

- Interfaces must be prefixed with `I` (`@typescript-eslint/naming-convention` reports an error otherwise).
- Every class member needs an explicit `public`/`private`/`protected` (`explicit-member-accessibility`).
- Use single quotes, trailing commas and 2-space indent.
- Imports use the tsconfig path aliases `@modules/<module>/...` and `@common/...`. Absolute `src/...` paths also resolve (`baseUrl: ./`), but relative `../` imports are a lint error. Jest maps all of them in `moduleNameMapper`.
- `src/common/types/database.types.ts` is the generated Supabase `Database` type. ESLint and Prettier both ignore it.

## Schema

The schema lives in `supabase/migrations`:
- `20260101000000_baseline_schema.sql` is the baseline. It holds every public table, constraint, index, comment and RLS flag of the dev project, taken with `pg_dump --schema-only` and made idempotent. On a database that already has the schema it is a no-op. On an empty one it creates the tables that the later migrations rely on.
- The later migrations add RPCs (`get_projects_list`, `assign_project_assignments`, `get_user_projects`, `get_time_entries_list`) and constraints.
- `src/common/types/database.types.ts` is generated from the dev project.

To change the schema:
1. Add a new migration (`npx supabase@latest migration new <name>`).
2. Regenerate `database.types.ts`.
3. Update the repository's `mapToViewModel`.

Pushing to the dev project:
- The dev project has every migration applied, the baseline included (it was a no-op there). New migrations go out with `supabase db push`.
- The direct DB host is IPv6-only. From an IPv4 network, use the session pooler (`aws-1-us-east-1.pooler.supabase.com:5432`, user `postgres.<project-ref>`).
- Any other database that has the schema but not the migration history needs `--include-all` on its first push.

How the tables handle foreign keys:
- Every table has an FK to `slack_teams` with `ON DELETE CASCADE`. Uninstalling the app deletes the `slack_teams` row and relies on this cascade.
- RLS is enabled on the vacation tables and has no policies. The app uses the service-role key, which bypasses RLS. The time tracking tables don't have RLS yet.

## Architecture

### Multi-tenancy

Each Slack workspace that installs the app gets a `slack_teams` row. There are two different IDs to keep apart:
- `slack_teams.slack_id`: Slack's own `T…` workspace ID.
- `slack_team_id`: the internal UUID, used as the foreign key on every other table.

Almost every service and repository query must be scoped by `slackTeamId` / `slack_team_id`. The bot token is stored on `slack_teams.slack_token`. Every outgoing Slack call goes through `SlackCommunicationService`, which looks up the token per workspace via `AccessTokenService`; the token is cached for 1 day.

### HTTP pipeline for Slack (Slack Bolt's receiver is not used; Bolt is only imported for types)

1. `main.ts` mounts `slackBodyParserMiddleware` on `/api/slack`. It keeps `req.rawBody` for signature checks, then parses the body as JSON or urlencoded.
2. `SlackPayloadParseMiddleware` (wired in `SlackModule.configure`) unwraps the form field `payload` for `/interactions` and `/options`.
3. Guards run in this order: `SlackSignatureGuard` → `SlackUserGuard` (loads the DB user by Slack user ID into `req.user` and returns 401 if the user is unknown) → `SlackActiveUserGuard` → `UserRoleGuard` + `@RequireRoles`.

Controllers are in `src/slack/controllers/`:
- OAuth redirect: calls `TeamSetupWorkflowService`, which creates the `slack_team` and an admin user, then starts a background sync of workspace users.
- `/vacations` slash command.
- Admin commands.
- Events: home tab opened, `file_shared` (starts the CSV import), `team_join`/`user_change` (user upsert), `app_uninstalled`.
- Interactions.
- Options (external select search).

### Interaction dispatch (the most important pattern)

- Handlers are `@Injectable()` classes decorated with `@SlackHandler({ type, callbackId, allowedRoles? })`.
- `SlackHandlersRegistry` finds them at startup through `DiscoveryService` and keys them by `${type}:${callbackId}`.
- How `callbackId` is resolved:
  - `view_submission`: `view.callback_id`.
  - `block_actions`: the **`block_id` of the first action**. Every actionable block in a tab or message therefore has to use the matching `ViewCallbackId` as its `block_id`.
- `SlackInteractionsService` enforces `allowedRoles` and blocks inactive users before it calls the handler.
- `BaseActionHandler` (for `block_actions`) dispatches on `action_id` through `actionMap`. `BaseAdminTabActionHandler` adds the shared admin navigation actions. Helpers such as `withPagination`, `withMenuAction` and `withButtonAction` unpack action values.
- `BaseModalFormSubmitHandler<Metadata, FormData, Result>` (for `view_submission`):
  - Parses `private_metadata` as JSON.
  - Validates `view.state.values` with a `BaseValuesParser` (a zod schema plus field config), returning field-level errors.
  - Calls `onSubmit`.
  - Maps known domain errors (`ValidationError`, `MaxItemsCountReachedError`, `EntityHasDependenciesError`, `PrimaryEntityDeleteError`, `ForbiddenException`) to a message shown in the modal. Any other error shows a generic message.
  - Build responses with `SlackViewResponseFactory`.
  - A parser reads each field by its config key as the `action_id`, so the view element must use that key as its `action_id`. The integration tests' `submitView` fills forms from the real view and catches a mismatch.
- Slack shows an interaction as failed when the answer takes over 3 seconds. Work that updates several messages or notifies people (deciding workflow steps, "Approve for Approvers") runs after the answer through `runInBackground` (`src/common/utils/run-in-background.ts`), which logs its errors. Checks that can fail run before it, so the modal can still show them.

To add an interaction:
1. Add a `ViewCallbackId` value (`src/slack/enums/integration-callback-id.enum.ts`).
2. Create the decorated handler.
3. Register it as a provider in its feature module.

### App Home "tabs"

The UI is a single App Home view that gets re-published to show different screens (`TabId`: Home, Users, Teams, Holidays, VacationPolicies, VacationRequests, VacationsHistory).

- Each screen lives in `src/slack/tabs/<name>/`, with `handlers/`, `parsers/`, `services/` and `views/` and its own Nest module.
- A tab service extends `BaseTabService`. In `onModuleInit` it subscribes to `TabNavigationService` (EventEmitter2 events named by `TabId`).
- `tabNavigationService.navigate(TabId.X, { user, metadata })` re-renders a tab from anywhere.
- Tab state such as pagination and filters round-trips through the view's `private_metadata`. Modals carry it along as `pageMetadata` so they can re-render the tab after a submit.
- If rendering fails, the user sees `FallbackTabView`; inactive users see `InactiveUserTabView`.
- Views are injectable classes that return Block Kit JSON.

### Domain layer

Domain modules: `users`, `teams`, `vacation-policies`, `vacation-requests`, `holidays`, `slack-teams`, `request-workflows`. They follow Repository → Service:

- **Repositories** extend `BaseRepository<Tables['x'], ViewModel>` (`src/common/repositories/base.repository.ts`). It uses the Supabase JS client with the service-role key and does no ORM work. Subclasses set:
  - `tableName`;
  - `relations` (embedded PostgREST selects);
  - `searchableColumns`;
  - `mapToViewModel`.

  Filters are `SupabaseFilter`. A filter value can be a plain value (`eq`) or `{ operator, value }`.
- **Services** take camelCase params and convert them to snake_case filters, usually in a private `getFindQuery`. Services also enforce per-workspace limits from env (`MAX_TEAMS_PER_SLACK_TEAM`, `MAX_POLICIES_PER_SLACK_TEAM`, `MAX_*_REQUESTS_PER_USER`) and throw the domain errors from `src/common/errors/`.
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

   Each level has an `ApprovalRule` of `ANY` or `ALL`. If the team has no approvers, no workflow is created.
3. `RequestWorkflowService` stores one row per approver in `vacation_request_workflow_steps` and activates level 1 through `WorkflowStepProcessorService`.
4. Step processors are registered with `@WorkflowStepProcessor(type)` and found by `WorkflowStepProcessorsRegistry` (the same discovery pattern as Slack handlers). The only type is `approver`: `ApproverStepProcessor` sends each approver a DM with Approve / Reject / Comment buttons.
5. Button clicks go to `ApproverStepMessageHandler` (`block_id` `workflow_step_message`):
   - `ANY`: one approval completes the level.
   - `ALL`: the level waits until there are no pending steps.
   - A reject at any level ends the workflow.
   - Comments re-render the messages of all pending steps.
   - By design a step is not tied to the user who clicks: HR and admins may decide for an approver who is away, so a request doesn't get stuck. In the UI they do it with "Approve for Approvers" in the Vacation Requests tab (`ApproveVacationRequestOnBehalfHandler` → `RequestWorkflowService.approveCurrentLevel`), which approves every open step of the current level and moves on.
6. When the workflow finishes it emits `VacationWorkflowFinished`. `RequestWorkflowProcessingService` then sets the request status and notifies the requester and the team's `approval_notification_recipients`.

Request create/update/delete events also invalidate `VacationPeriodUsageCacheService`.

### Other pieces

- **Vacation year and limits** (`VacationsUsageService`):
  - The year runs from the contract start anniversary, or over the calendar year when the user has no contract start date (`vacation-period.utils.ts`).
  - Limits come only from the vacation policy of the user's team. With no policy, `limits` is null: usage is tracked and shown, but no balance is checked. This is the "no setup" mode.
  - The usage cache holds one entry per user and is dropped on any event for that user's requests.
- **Working days:** `VacationDaysCalculationService` excludes weekends and the enabled holidays of the user's vacation policy. Holidays can be imported per country from Nager.Date (`src/holidays/clients/nager-date.client.ts`).
- **CSV imports:** an admin command posts a prompt, the admin uploads a file, Slack sends `file_shared`, and `FileUploadService` routes the file **by its name** to `src/user-data-import/`:
  - `user-vacations.csv` (`/upload-vacations`): sets the contract start date and replaces the user's vacations;
  - `user-team-mapping.csv` (`/user-team-mapping`): `email;team_name` (both CSVs use `;`), moves users to the team with that exact name.
- **Caching:** `CacheModule.register()` is in-memory, so each process has its own cache (access tokens, vacation usage). That's fine because production runs a single instance. Running more instances would need a shared store, for example Redis via Keyv.
- **Logging:** `nestjs-pino`, pretty-printed unless `NODE_ENV=production`.
- **Deploy:** multi-stage `Dockerfile` (Node 26 alpine, `PORT=10000`; `docker-compose.yml` sets `PORT` from `.env`, default 3000). The `public/` folder is served statically; the OAuth flow redirects to `/success.html`.
