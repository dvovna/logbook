// One line of the checkup's report. `fix` says what to do about a warning or
// a failure. No value of a secret goes into `detail` or `fix`.
export interface ICheckResult {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
  fix?: string;
}

export type CheckGroup = 'env' | 'database' | 'app' | 'slack';

export const CHECK_GROUPS: CheckGroup[] = ['env', 'database', 'app', 'slack'];

// The process's environment, or any stand-in for it.
export type EnvVars = Record<string, string | undefined>;
