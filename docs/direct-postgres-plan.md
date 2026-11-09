# Data access over a direct Postgres connection

Status: proposal with a working prototype, for a decision before Time & Billing
stage 3 (billing snapshots, dvovna/logbook#12).

## Summary

Keep Supabase as the Postgres host: the database itself, the CLI for
migrations and the local stack, and Studio. Stop reaching the data through
PostgREST. The backend gets one pool on `DATABASE_URL` and builds its queries
with [Kysely](https://kysely.dev) 0.28, typed from the generated
`database.types.ts`. Transactions are written in TypeScript, and a pg-boss job
can be saved in the same transaction as the change it is about.

The prototype on this branch shows it working: `SqlRepository` has the public
interface of `BaseRepository`, `clients` runs on it end to end, and a job is
enqueued in a transaction. `yarn test` (197), `yarn test:int` (289),
`npx tsc --noEmit`, `yarn lint` and `yarn build` pass.

Recommendation: do stage 1 below now, then move `time_entries`, `projects` and
`clients` before billing snapshots start. Billing can then be written on the
direct connection from its first line.

## Why

PostgREST is a good API for browsers. From a backend it costs us more than it
gives:

- **No transactions across requests.** PostgREST runs each request in its own
  transaction. Every atomic multi-step write therefore became a plpgsql
  function: `create_workspace`, `decide_workflow_steps`,
  `replace_user_vacations`, `replace_country_holidays`,
  `assign_project_assignments`. Logic is split between TypeScript and SQL, the
  functions need their own grants (`SECURITY DEFINER` ones especially), and a
  new atomic operation means a migration.
- **Data and jobs can't share a transaction.** Data goes over HTTPS through
  PostgREST, jobs over `DATABASE_URL` (pg-boss). A write can commit and its job
  never be saved, or the other way round. Billing snapshots need exactly that:
  freeze the totals, lock the entries, mark the period invoiced, and enqueue
  the notifications, all or nothing.
- **Workarounds for the transport.** `findMany` pages through PostgREST's
  silent 1000-row `max_rows` cap, search terms must be quoted into PostgREST's
  filter syntax (`quoteFilterValue`), and supabase-js loses the table's types
  behind a union, so `BaseRepository` casts (`as unknown as`, `@ts-ignore`,
  `as never`).
- **Two connection setups.** Self-hosting needs PostgREST, its keys and a
  Postgres URL. The end state needs only the URL.

## What the prototype shows

| File | What it is |
| --- | --- |
| `src/database/database.service.ts` | The pool (`DATABASE_URL`, `DATABASE_POOL_SIZE`), Kysely, `transaction()`, `afterCommit()`, `lock()`, and an executor for pg-boss. |
| `src/database/pg-type-parsers.ts` | Values as PostgREST returns them: timestamps as the same ISO strings, dates as text, bigint and numeric as numbers. Only for this pool; pg-boss keeps the defaults. |
| `src/common/types/sql-database.types.ts` | Kysely's database type, derived from `database.types.ts`. |
| `src/common/repositories/repository.types.ts` | What both repositories share: the filter types, the workspace checks, `IRepository`. |
| `src/common/repositories/sql.repository.ts` | `BaseRepository`'s interface over Kysely: filters, search, relations, upsert, the workspace checks, and scoped builders for hand-written queries. |
| `src/clients/…` | `ClientsRepository` on `SqlRepository`. `ClientsService.create` checks the per-workspace limit and inserts in one transaction under an advisory lock. `delete` is one typed statement. |
| `src/common/jobs/jobs.service.ts` | `enqueue()`: saves the job in the current transaction and runs it first after the commit. |
| `test/integration/repository.int-spec.ts` | The same cases against both implementations, which behave the same. |
| `test/integration/direct-postgres.int-spec.ts` | Rows read through the pool equal PostgREST's for five tables, relations included. Rollback, commit and after-commit behaviour. The client limit under concurrent creates (this test fails without the lock). A job saved with a change: it runs after the commit, nothing is saved on a rollback, and it is retried when the first run fails. |
| `src/common/repositories/sql.repository.spec.ts` | The SQL each method generates, compiled by a recording driver without a database. |

The other 13 repositories still run on `BaseRepository` over PostgREST.

## Decisions

### 1. `DATABASE_URL` becomes required

The prototype already makes it required (`src/env.schema.ts`) and adds
`DATABASE_POOL_SIZE` (default 5). It was optional only because jobs could run
without retries. With data on it, the app can't start without it.

Follow-ups in stage 1:

- Remove `JobsService`'s branch without a database. It is unreachable now, but
  its unit tests still construct the service without one.
- Point `/health` at the pool (`select 1`), and later only at the pool.
- Production must have `DATABASE_URL` set before deploying. pg-boss already
  uses it there, so its SSL settings are known to work.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` stay required until the last
  PostgREST caller is gone (stage 4).

### 2. The query builder: Kysely 0.28

Why Kysely:

- It is a query builder, not an ORM. It has no schema or migrations of its own,
  so `supabase/migrations` stays the only source of truth for the schema.
- The SQL it produces is predictable, and `sql` templates cover what the
  builder doesn't.
- It types results from the table and the selected columns, unlike
  supabase-js behind a generic table name.

Alternatives:

| Option | Why not |
| --- | --- |
| Drizzle | Wants its schema in TypeScript. It can be pulled from the database, but then two definitions of the schema exist and drizzle-kit pushes toward owning migrations. |
| Prisma | Own schema language, own migrations, a query engine. Wrong direction for SQL-first migrations. |
| pgtyped or Slonik | Good for fixed SQL files (the list RPCs would fit), but there is no composable builder for the generic repository's filters. |
| Plain `pg` | No types, and filter building by hand. |

**Version.** Use 0.28.x, not 0.29. Kysely 0.29 is ESM-only. Node 26 can
`require()` it, but Jest's CommonJS module loader (ts-jest) can't load it
without transforming `node_modules`. The project made the same call for
pg-boss 12. The 0.28 line still gets patch releases (0.28.19 on 2026-11-01).
Revisit when the project moves to ESM.

**Types.** The prototype derives Kysely's database type from the generated
`database.types.ts`: a column reads as its `Row` type and is written as its
`Insert` and `Update` types. One generated file serves both data layers, and
CI's `yarn db:types` check covers both. The alternative is kysely-codegen,
which generates from a live database. It reads more (enums from check
constraints don't come through either way) but would need its own generated
file and CI check. Keep deriving. Reconsider in stage 5 if self-hosting
without the Supabase CLI matters.

**Value formats.** By default node-postgres returns `Date` for timestamps and
strings for bigint and numeric, while the view models were written against
PostgREST's JSON. The pool's type parsers return what PostgREST returns:

- `2026-06-17T10:00:00.123456+00:00`, microseconds included, in UTC (the pool
  sets the session time zone);
- dates as `2026-06-17`;
- bigint and numeric as numbers.

`direct-postgres.int-spec.ts` compares whole rows for five tables. Numeric as
a JS number loses precision, as it does through PostgREST today. Billing
snapshots should store money as integer minor units, or map their numeric
columns to strings.

### 3. Workspace scoping

What stays enforced:

- The generic methods run the same `assertScoped` and `assertRowsScoped` as
  before (now in `repository.types.ts`). A query or insert on a workspace's
  table without `slack_team_id` throws before any SQL runs, and one on
  `slack_teams` without a filter does too. `sql.repository.spec.ts` checks it.
- Queries a repository writes itself start from
  `selectInWorkspace`/`updateInWorkspace`/`deleteInWorkspace(slackTeamId)`.
  These add the condition and refuse an empty ID, and the rest of the query
  stays fully typed (`ClientsRepository.deleteOne`).
- The integration tests that probe isolation (`workspace-isolation`,
  `object-access`, `access-control`) keep running against whatever
  implementation a repository uses.

What becomes easier to get wrong: a raw `this.db.selectFrom('time_entries')`
compiles without a workspace condition. Two measures for stage 1:

- **Only repositories and query classes touch Kysely.** Split
  `DatabaseService` into `TransactionService` (`transaction`, `afterCommit`,
  `lock`) for services and the executor for repositories. Enforce it with an
  `import/no-restricted-paths` zone, as is done for `src/slack`.
- **Review rule.** Every hand-written query starts from an `…InWorkspace`
  builder, or says in a comment why it is global (retention, the migrations
  check).

Considered and not proposed now: row-level security per workspace, with
`set_config('app.slack_team_id', …, true)` in every transaction and policies
on a non-owner role. It is real defence in depth, but every query would need a
transaction or a per-checkout `SET`. Cross-workspace work (retention, jobs that
start from IDs) would need a bypass role, and the app would need two roles.
Keep it as an option if the app ever gets more than one writer.

### 4. Transactions in TypeScript

```ts
return this.database.transaction(async () => {
  await this.database.lock(`clients:${slackTeamId}`);
  const count = await this.clientsRepository.count({ slack_team_id: slackTeamId });
  if (count >= max) throw new MaxItemsCountReachedError(max, 'clients');
  return this.clientsRepository.create({ ... });
});
```

- **Ambient transaction.** `transaction(work)` keeps the transaction in an
  `AsyncLocalStorage`, and every repository call inside `work` uses it. No
  `trx` parameter has to go through the services. A `transaction()` inside
  another one joins it; there are no savepoints.
- **After the commit.** `afterCommit(fn)` runs `fn` as background work once
  the transaction has committed, and never after a rollback. Jobs' first runs,
  events and Slack messages go there.
- **Locks.** `lock(key)` takes `pg_advisory_xact_lock` until the end of the
  transaction. Use it for check-then-write (limits, "no overlapping vacation");
  unique constraints remain the first choice where they fit. Isolation stays
  READ COMMITTED.
- **Jobs in the transaction.** `jobs.enqueue(name, payload)` inside a
  transaction saves the job through pg-boss's `db` option on the
  transaction's connection, then runs it after the commit. A rollback leaves
  no job. `jobs.run()` stays for work outside transactions. The integration
  test rejects a time entry and enqueues the owner's DM in one transaction.
- **Rules:**
  - No Slack or other HTTP calls inside a transaction: they hold a connection
    and the locks while waiting.
  - Emit events after the commit. `EventTrackingService` starts listeners in
    the emitter's async context, so a listener started inside a transaction
    would use its connection. The prototype sends work that outlives the
    transaction to the pool, but a listener that runs during it would join it.
  - A transaction must not mix in PostgREST calls (see Risks).

### 5. The RPCs: back to TypeScript, or stay in SQL

During the move, any function can be called over the direct connection as it
is (``sql`select * from get_time_entries_list(…)` ``). So no RPC has to be
rewritten before its repository moves. Afterwards:

| Function | Kind | Proposal |
| --- | --- | --- |
| `create_workspace` | write, 2 tables | TypeScript transaction in `TeamSetupWorkflowService`. Enqueue the member sync job in the same transaction; today a crash between the two leaves a workspace that never syncs. |
| `replace_user_vacations` | write, delete then insert | TypeScript transaction. The typed insert replaces `jsonb_populate_recordset`. |
| `replace_country_holidays` | write, delete then insert | TypeScript transaction. |
| `assign_project_assignments` | write, 4 statements | TypeScript transaction. |
| `decide_workflow_steps` | one conditional `UPDATE` | A Kysely statement in the steps repository. Its safety comes from `where completed_at is null`, not from being a function. `WorkflowDecisionsService` can then enqueue the next steps' jobs in the same transaction as the decision. Removes a `SECURITY DEFINER` function. |
| `get_projects_list`, `get_user_projects` | read | Kysely queries in the query classes, with typed rows instead of `as IProjectListItemWithTotalCount[]`. |
| `get_time_entries_list` | read, the largest | Call it through the pool first. Convert it to Kysely last, or keep it as SQL if the builder version reads worse. |
| `applied_migrations` | read | Read `supabase_migrations.schema_migrations` directly. The function exists only because PostgREST can't reach that schema. |

What stays SQL: constraints (the 24-hours-per-day check, uniqueness, foreign
keys with cascades), and set-based statements such as computing a billing
snapshot with `insert … select`, written as Kysely or `sql` inside a
TypeScript transaction. Drop a function in a migration one release after the
code that called it is gone, so that a rollback of the app still finds it.

### 6. Connections on Supabase

- **Session pooler, port 5432** (Supavisor in session mode). It is IPv4,
  unlike the direct host `db.<ref>.supabase.co`, which is IPv6-only without
  the IPv4 add-on. It keeps session semantics: `SET`, advisory locks and
  prepared statements behave as on a direct connection. pg-boss already uses
  it. The transaction pooler (6543) would break the session time zone the
  pool sets and gains nothing for a single instance.
- **Limits.** In session mode, the clients a project may have at once are
  capped by the "Pool Size" in the database settings. Backends are capped by
  Postgres `max_connections`: 60 on Nano and Micro, 90 on Small, per the
  [compute add-ons page](https://supabase.com/docs/guides/platform/compute-add-ons).
  PostgREST, Auth and Studio take their own share. The budget per app
  instance is 5 (`DATABASE_POOL_SIZE`) plus 2 (pg-boss) = 7. Production runs
  one instance (in-memory caches and token refresh, see `CLAUDE.md`), but a
  rolling deploy overlaps two for a moment: 14. Check the project's Pool Size
  before stage 2 and lower the pool to 4 if it is 15.
- **Timeouts.** Set `statement_timeout` (10 s) and
  `idle_in_transaction_session_timeout` (30 s) on the pool's connections in
  stage 1, so that a stuck query or a forgotten transaction can't hold a
  connection.
- **Credentials.** `DATABASE_URL` carries the `postgres` role, which bypasses
  RLS like the service role key does now. Optionally give the app a role
  without DDL rights and keep `postgres` for migrations.

### 7. Effects on CI, tests and self-hosting

- **CI type generation:** unchanged. The `yarn db:types` diff check covers the
  only generated file, and Kysely's types follow it. If kysely-codegen is ever
  adopted, it needs its own script and diff check.
- **Integration tests:**
  - They already had `DATABASE_URL` (the local stack's `DB_URL`) for the job
    queue, so nothing changes in `global-setup`.
  - Fixtures (`TestWorkspace`) keep using supabase-js until stage 4, then move
    to Kysely. `t.db` then becomes the pool, and `global-setup` needs only the
    database URL.
  - `repository.int-spec.ts` runs both implementations until `BaseRepository`
    is gone.
- **Unit tests:** `SqlRepository` is tested by the SQL it compiles (a
  recording Kysely driver). This is more direct than the PostgREST builder
  fake in `base.repository.spec.ts`.
- **Self-hosting:** the end state needs Postgres and one URL; no PostgREST,
  no Supabase keys. Not yet plain Postgres, though:
  - The migrations grant to and revoke from Supabase's roles (`anon`,
    `authenticated`, `service_role`) in six files, so they fail where those
    roles don't exist.
  - They are applied with the Supabase CLI, which can push to any Postgres URL
    (`supabase db push --db-url`) and records the history the app checks.

  Stage 5 makes them run elsewhere (a bootstrap that creates the roles, or
  grants wrapped in `if exists`) and adds a `docker-compose` with a Postgres
  service.

## Stages

Each stage leaves the app working and deployable on its own.

**Stage 0: this prototype.** Kysely, `DatabaseService`, `SqlRepository`,
`clients` converted, `jobs.enqueue`. `DATABASE_URL` required.

**Stage 1: foundation (small).**
- Set `DATABASE_URL` in every environment before the deploy.
- Remove the job queue's no-database branch and rewrite its unit spec.
- `/health` checks the pool.
- Add statement and idle-in-transaction timeouts.
- Split `TransactionService` from the executor and add the lint zone.
- Update README → Self-hosting and `.env.example`.

**Stage 2: repositories, one per PR (medium overall).**
- In rough order of risk: `holidays`, `vacation-policies`, `projects` (with
  `project_teams` and `project_users`), `users`, `teams` (relation),
  `vacation-requests` (relations), `time-entries` (relations),
  `request-workflow-steps` and comments, `slack-teams` (no workspace column;
  `AccessTokenService`).
- Each one changes `extends BaseRepository<Tables['x'], VM>` to
  `extends SqlRepository<'x', VM>`, rewrites `relations` in the new form, and
  moves its query classes to `this.db` or `sql`.
- The integration suite is the safety net: it already covers every screen and
  flow.
- Billing snapshots can start once `time-entries`, `projects` and `clients`
  are on the pool: locking entries and writing the snapshot need one
  transaction.

**Stage 3: write RPCs to TypeScript (medium).**
- `create_workspace`, the two `replace_*` imports and
  `assign_project_assignments` become transactions.
- `decide_workflow_steps` becomes a Kysely statement, and the workflow's jobs
  are enqueued with their decisions.
- The functions are dropped a release later.

**Stage 4: remove PostgREST (small).**
- Delete `SupabaseService`, `BaseRepository` and `quoteFilterValue`, and
  rename `SqlRepository` to `BaseRepository`.
- Remove `@supabase/supabase-js`, and `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` from the env.
- Move the test fixtures to Kysely, and the migrations check to a direct
  query.
- RLS stays enabled with no policies, so the REST API stays closed if the
  project exposes it.

**Stage 5, optional: plain Postgres for self-hosting.** Role bootstrap or
conditional grants, and a compose file with Postgres.

## Risks

- **Two data paths during stage 2.** A transaction on the pool doesn't include
  PostgREST calls made inside it. A service that mixes a converted and an
  unconverted repository in one `transaction()` gets false atomicity, and its
  PostgREST reads don't see the uncommitted writes. Move the repositories a
  flow needs together, and don't wrap a flow in a transaction until all of
  them are on the pool.
- **Async context.** Work started inside a transaction inherits it. The
  prototype hands work that outlives the transaction to the pool, but
  listeners that run during it would join it. The rule is to emit after the
  commit. Stage 1 could enforce it by making `EventTrackingService` defer
  emits made inside a transaction to `afterCommit`.
- **Connection budget.** Exhausting the session pooler gives "max clients
  reached" errors, not slowness. Size the pool, keep transactions short, no
  HTTP inside them, and add the timeouts.
- **Behaviour PostgREST had that code relied on:**
  - `update` changes exactly one row or nothing; kept, and tested for both
    implementations.
  - Value formats; kept by the type parsers, and tested.
  - Differences on purpose: `eq: null` now means `is null` (PostgREST's
    `eq.null` never matched a null); `%` and `_` in a search term are text
    (PostgREST passed them to `ilike` as wildcards); there are no more
    1000-row pages.
- **Kysely 0.28 being superseded.** If 0.28 stops getting fixes before the
  project is ESM, run Jest with a transform for kysely's ESM build or move to
  ESM. The same pressure exists for pg-boss.
- **Supabase-specific migrations.** They block plain-Postgres self-hosting
  until stage 5. This doesn't affect Supabase-hosted installs.
