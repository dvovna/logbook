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
yarn lint             # eslint with --fix (it rewrites files)
yarn format           # prettier
npx tsc --noEmit      # type-check only
```

- **There are no tests.** Jest is in devDependencies but there is no jest config, no `test` script and no spec files.
- `yarn db:init` doesn't map to any command in `src/` (nest-commander and TypeORM are installed but unused). The schema is in `src/commands/init.sql` and has to be applied by hand.
- The app validates env vars with zod (`src/env.schema.ts`) at startup and **exits** if any are missing. Copy `.env.example` to `.env` first.
- Local Slack development needs a public HTTPS URL (ngrok). Slack's request URLs point to `/api/slack/...`, and installation goes through `https://slack.com/oauth/v2/authorize?client_id=...&scope=commands,users:read,users:read.email,channels:read,chat:write&redirect_uri=https://{ngrok_domain}/api/slack/oauth/redirect`.

## Conventions enforced by lint/config

- Interfaces must be prefixed with `I` (`@typescript-eslint/naming-convention` reports an error otherwise).
- Every class member needs an explicit `public`/`private`/`protected` (`explicit-member-accessibility`).
- Use single quotes, trailing commas and 2-space indent.
- Imports use absolute `src/...` paths (`baseUrl: ./`), not relative paths.
- `src/common/types/database.types.ts` is the generated Supabase `Database` type. The ESLint ignore entry points to a stale path (`src/types/...`), so `yarn lint` will reformat this generated file.

## Schema source of truth

`database.types.ts` reflects the live schema. `init.sql` has drifted from it: for example it lacks `teams.description` and `vacation_requests.user_comment`, and its `users.role` CHECK doesn't include `manager`. When you change the schema, update `database.types.ts` and the repository `mapToViewModel`, not only `init.sql`.

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
- **Caching:** `CacheModule.register()` is in-memory, so each process has its own cache (access tokens, vacation usage). With more than one instance, the caches won't share data or invalidations.
- **Logging:** `nestjs-pino`, pretty-printed unless `NODE_ENV=production`.
- **Deploy:** multi-stage `Dockerfile` (Node 20 alpine, `PORT=10000`). The `public/` folder is served statically; the OAuth flow redirects to `/success.html`.
