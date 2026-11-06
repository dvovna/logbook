# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-tenant Slack app (NestJS 11, TypeScript) for managing vacation requests: users request time off from the bot's App Home, the request goes through an approval workflow, and admins/HR manage users, teams, policies and holidays. Data lives in Supabase (Postgres).

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
yarn db:init          # apply src/commands/init.sql to SUPABASE_DB_URL from .env
npx supabase@latest start                                                    # local Supabase in Docker
yarn slack:event src/commands/slack-events/team-join.json --team T0123ABCD   # signed event to the local app
```

- Tests are `*.spec.ts` files next to the code (rootDir `src`, config in `jest.config.ts`). They build services directly with `jest.fn()` mocks rather than through a Nest testing module. `jest.config.ts` pins `TZ=UTC`, because the date code mixes local `getDay()` with `toISOString()` and production runs in UTC.
- `yarn db:init` runs `src/commands/db-init.ts` through ts-node and applies `init.sql` in a single transaction. The SQL is idempotent, so running it again on an existing DB is safe. `src/commands` is excluded from `nest build`.
- The codebase is not lint-clean: about 140 prettier and other errors already exist. `yarn lint` uses `--fix`, so it rewrites many unrelated files. To lint only what you touched, run `npx eslint <files>`.
- The app validates env vars with zod (`src/env.schema.ts`) at startup and **exits** if any are missing. Copy `.env.example` to `.env` first.
- Local setup is in README → "Local development":
  - Local Supabase from `supabase/config.toml`. Only Postgres, the API, auth and Studio are enabled. Auth is unused by the app but the CLI prints the API keys only with it on.
  - A dev Slack app from `slack-app-manifest.dev.yml`, reached through ngrok.
  - Install the dev app through the OAuth URL, not the "Install to Workspace" button: only the OAuth redirect creates the `slack_teams` row.
- `yarn slack:event <payload.json> [--team <T-id>] [--url <url>]` (`src/commands/send-slack-event.ts`) signs a payload with `SLACK_SIGN_IN_SECRET` and posts it to `/api/slack/events`. Use it to exercise event handlers without Slack. Samples in `src/commands/slack-events/` use `T_LOCAL` as the workspace ID, which `--team` replaces.

## Conventions enforced by lint/config

- Interfaces must be prefixed with `I` (`@typescript-eslint/naming-convention` reports an error otherwise).
- Every class member needs an explicit `public`/`private`/`protected` (`explicit-member-accessibility`).
- Use single quotes, trailing commas and 2-space indent.
- Imports use absolute `src/...` paths (`baseUrl: ./`), not relative paths. Jest maps them with `moduleNameMapper`.
- `src/common/types/database.types.ts` is the generated Supabase `Database` type. ESLint and Prettier both ignore it.

## Schema

There are two schema files, and they are kept in sync column for column, including nullability:
- `src/common/types/database.types.ts`: generated from the live Supabase DB.
- `src/commands/init.sql`.

When you change the schema, update `init.sql` (idempotent DDL: `IF NOT EXISTS`, plus a `DO` block for FKs added after the fact), `database.types.ts`, and the repository's `mapToViewModel`.

There are no Supabase migrations. The local stack loads `init.sql` as a seed (`[db.seed]` in `supabase/config.toml`) on first start and on `db reset`.

How `init.sql` handles foreign keys:
- Every table has an FK to `slack_teams` with `ON DELETE CASCADE`. Uninstalling the app deletes the `slack_teams` row and relies on this cascade.
- NOT NULL audit columns (`created_by`/`updated_by`) use the default `NO ACTION`. That way a single user can't be hard-deleted while their rows remain (users are deactivated instead), but the workspace cascade still goes through.
- RLS is enabled on every table with no policies. The app uses the service-role key, which bypasses RLS.

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
6. When the workflow finishes it emits `VacationWorkflowFinished`. `RequestWorkflowProcessingService` then sets the request status and notifies the requester and the team's `approval_notification_recipients`.

Request create/update/delete events also invalidate `VacationPeriodUsageCacheService`.

### Other pieces

- **Working days:** `VacationDaysCalculationService` excludes weekends and the enabled holidays of the user's vacation policy. Holidays can be imported per country from Nager.Date (`src/holidays/clients/nager-date.client.ts`).
- **CSV import of historical vacations:** an admin command posts a prompt, the admin uploads a file, Slack sends `file_shared`, and the file goes through `FileUploadService` and then `src/user-data-import/`.
- **Caching:** `CacheModule.register()` is in-memory, so each process has its own cache (access tokens, vacation usage). That's fine because production runs a single instance. Running more instances would need a shared store, for example Redis via Keyv.
- **Logging:** `nestjs-pino`, pretty-printed unless `NODE_ENV=production`.
- **Deploy:** multi-stage `Dockerfile` (Node 20 alpine, `PORT=10000`). The `public/` folder is served statically; the OAuth flow redirects to `/success.html`.
