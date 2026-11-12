import { checkApp } from 'src/checkup/app.check';
import {
  CHECK_GROUPS,
  CheckGroup,
  EnvVars,
  ICheckResult,
} from 'src/checkup/check.types';
import { checkDatabase, Query } from 'src/checkup/database.check';
import { appDomainOf, checkEnv } from 'src/checkup/env.check';
import { checkSlackApp } from 'src/checkup/slack.check';

export const USAGE = `Usage: pnpm checkup [${CHECK_GROUPS.join('] [')}]\nWith no names, every check runs.`;

export interface ICheckupDeps {
  env: EnvVars;
  connect: (
    url: string,
  ) => Promise<{ query: Query; close: () => Promise<void> }>;
  fetch?: typeof fetch;
}

const MARKS: Record<ICheckResult['status'], string> = {
  ok: '✓',
  warn: '!',
  fail: '✗',
  skip: '–',
};

export const groupsOf = (args: string[]): CheckGroup[] => {
  const unknown = args.filter(
    (arg) => !CHECK_GROUPS.includes(arg as CheckGroup),
  );

  if (unknown.length) {
    throw new Error(`Unknown check: ${unknown.join(', ')}\n\n${USAGE}`);
  }

  return args.length ? (args as CheckGroup[]) : CHECK_GROUPS;
};

// Runs the checks an install or an update can be judged by, each on its own:
// a failure of one doesn't stop the others.
export async function runCheckup(
  groups: CheckGroup[],
  { env, connect, fetch: fetchImpl }: ICheckupDeps,
): Promise<ICheckResult[]> {
  const domain = appDomainOf(env);
  const checks: Record<CheckGroup, () => Promise<ICheckResult[]>> = {
    env: () => Promise.resolve(checkEnv(env)),
    database: () =>
      env.DATABASE_URL
        ? checkDatabase(() => connect(env.DATABASE_URL!))
        : Promise.resolve([
            {
              name: 'Database',
              status: 'skip' as const,
              detail: 'DATABASE_URL is not set',
            },
          ]),
    app: () => checkApp(domain, fetchImpl),
    slack: () => checkSlackApp(env, domain, fetchImpl),
  };
  const results: ICheckResult[] = [];

  for (const group of CHECK_GROUPS.filter((g) => groups.includes(g))) {
    results.push(...(await checks[group]()));
  }

  return results;
}

// One line a check, and under a warning or a failure what to do about it.
export const report = (results: ICheckResult[]): string =>
  [
    ...results.flatMap(({ name, status, detail, fix }) => [
      `${MARKS[status]} ${name}: ${detail}`,
      ...(fix && status !== 'ok' ? [`    → ${fix}`] : []),
    ]),
    '',
    summaryOf(results),
  ].join('\n');

const summaryOf = (results: ICheckResult[]) => {
  const count = (status: ICheckResult['status']) =>
    results.filter((result) => result.status === status).length;
  const parts = [
    `${count('ok')} ok`,
    ...(count('warn') ? [`${count('warn')} to look at`] : []),
    ...(count('fail') ? [`${count('fail')} failed`] : []),
    ...(count('skip') ? [`${count('skip')} skipped`] : []),
  ];

  return parts.join(', ');
};

export const failed = (results: ICheckResult[]) =>
  results.some(({ status }) => status === 'fail');
