import { IPercentiles } from './timings';

export interface ILoadReport {
  setup: Record<string, number>;
  // Every answer, and by what was clicked.
  answers: IPercentiles;
  byKind: Record<string, { answer: IPercentiles; screen?: IPercentiles }>;
  overLimit: { kind: string; wave: number; ms: number; error?: string }[];
  reminders: { people: number; sent: number; lastAfterMs: number };
  poolWaitMs: IPercentiles & { timeouts: number };
  eventLoopDelayMs: { p50: number; p99: number; max: number };
  statements: { count: number; background: number };
  elapsedMs: number;
  errors: string[];
}

const NAME_WIDTH = 34;

const row = (name: string, p: IPercentiles) =>
  name.padEnd(NAME_WIDTH) +
  [p.count, p.p50, p.p95, p.max].map((n) => String(n).padStart(7)).join('');

const header = (title: string) =>
  title.padEnd(NAME_WIDTH) +
  ['n', 'p50', 'p95', 'max'].map((n) => n.padStart(7)).join('');

// "message ×count", most frequent first.
const countsOf = (values: string[]) =>
  Object.entries(
    values.reduce<Record<string, number>>((counts, value) => {
      counts[value] = (counts[value] ?? 0) + 1;

      return counts;
    }, {}),
  )
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => `  ${value} ×${count}`);

// The report as a few tables, for the console; LOAD_REPORT has every answer
// over the limit and every error.
export const formatReport = (report: ILoadReport, limitMs: number) => {
  const screens = Object.entries(report.byKind).filter(
    ([, { screen }]) => screen,
  );
  const firstLine = (text: string) => text.split('\n')[0].slice(0, 120);

  return [
    '',
    `Monday peak: ${JSON.stringify(report.setup)}`,
    '',
    header('Answer to Slack (ms)'),
    row('all', report.answers),
    ...Object.entries(report.byKind).map(([kind, { answer }]) =>
      row(kind, answer),
    ),
    '',
    header('Screen or file after the click (ms)'),
    ...screens.map(([kind, { screen }]) => row(kind, screen!)),
    '',
    header('Database'),
    `${row('wait for a pool connection (ms)', report.poolWaitMs)}  timeouts: ${report.poolWaitMs.timeouts}`,
    `statements: ${report.statements.count}, ${report.statements.background} of them after the answer`,
    `event loop delay (ms): ${JSON.stringify(report.eventLoopDelayMs)}`,
    `reminders: ${JSON.stringify(report.reminders)}`,
    `all work done after ${report.elapsedMs} ms`,
    '',
    `Answers over ${limitMs} ms: ${report.overLimit.length || 'none'}`,
    ...countsOf(report.overLimit.map(({ kind }) => kind)),
    `Errors logged: ${report.errors.length || 'none'}`,
    ...countsOf(report.errors.map(firstLine)),
  ].join('\n');
};
