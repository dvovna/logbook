# Contributing

Thanks for helping. Bug reports, ideas and pull requests are all welcome.

## Reporting a bug

Open an issue with the bug report form. It asks for:
- what you did;
- what you expected and what happened instead;
- the app logs around that time, if you have them.

Remove tokens and personal data first. Security problems go through [SECURITY.md](SECURITY.md), not issues.

## Making a change

1. Set up the local environment as described in the README under "Development". The integration tests need the local Supabase stack (`yarn supabase start`).
2. Branch from `development` and keep the change focused.
3. Add or update tests:
   - unit tests (`*.spec.ts`) sit next to the code;
   - integration tests are in `test/integration`. Use them for anything a user does in Slack.
4. Before opening the pull request, make sure these pass:
   ```bash
   npx tsc --noEmit
   yarn test
   yarn test:int
   npx eslint src test
   ```
   The codebase is lint-clean and CI fails on any lint error. ESLint also reports code that Prettier would format differently; `yarn lint` or `yarn format` fixes that.
5. Open the pull request against `development`, and say what the change does and how you checked it.

## Conventions

- Imports use the path aliases (`@modules/<module>/...`, `@common/...`). Relative `../` imports are a lint error.
- Interfaces start with `I`. Class members have an explicit `public`, `private` or `protected`.
- A schema change is a new migration in `supabase/migrations` (`yarn supabase migration new <name>`). Never edit an applied migration, and regenerate `src/common/types/database.types.ts` after the change.
- Slack waits only 3 seconds for an answer to an interaction. Slow work runs after the answer, through `runInBackground`, or as a job (`JobsService`) when it must survive a restart and be retried.
- The Slack UI in `src/slack` uses the domain modules, never the other way round; a lint rule enforces it.

[CLAUDE.md](CLAUDE.md) explains the architecture and the patterns the code follows: Slack handler dispatch, App Home tabs, the approval workflow.

By contributing, you agree that your contribution is licensed under the project's license (AGPL-3.0-or-later).
