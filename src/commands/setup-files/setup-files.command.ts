import { basename } from 'path';
import {
  checkSetupFile,
  ISetupFileCheck,
  SetupFileKind,
} from 'src/commands/setup-files/check-setup-file';

export const USAGE = [
  'Usage:',
  '  pnpm files:check <file.csv|file.xlsx> [more files]',
  '',
  'Reads each file as Logbook would and lists the rows it could not use,',
  'before anyone sends the file to Logbook in Slack.',
].join('\n');

const KIND_NAMES: Record<SetupFileKind, string> = {
  team: 'team file',
  balances: 'leave balances',
  history: 'leave history',
};

// What only the workspace can tell, so the preview in Slack still decides.
const NOT_CHECKED: Record<SetupFileKind, string> = {
  team: "that each email is an active person in the Slack workspace, the teams that already exist and their leads, the roles of the leads (HR and Finance can't lead), the team limit when teams exist",
  balances:
    'that each email is an active person in the Slack workspace, that the person follows a vacation policy, and Balance on against a contract start Logbook already has',
  history:
    'that each email is an active person in the Slack workspace, and overlaps with leave that is already in Logbook',
};

export interface ISetupFilesDeps {
  readFile: (path: string) => Buffer | undefined;
  print: (line: string) => void;
  // YYYY-MM-DD.
  today: string;
}

const report = (path: string, check: ISetupFileCheck): string[] => {
  if (!check.kind) {
    return [`✗ ${path}: ${check.refusal}`];
  }

  const usable = check.rows - check.problems.length;

  return [
    `${check.problems.length ? '✗' : '✓'} ${path}: ${KIND_NAMES[check.kind]}, ${check.rows} ${check.rows === 1 ? 'row' : 'rows'}, ${usable} usable`,
    ...check.summary.map((line) => `    ${line}`),
    ...check.problems.map(({ row, reason }) => `    Row ${row}: ${reason}`),
    `    Not checked here: ${NOT_CHECKED[check.kind]}.`,
  ];
};

// Resolves to whether every file is one Logbook would take whole.
export const checkFiles = async (
  paths: string[],
  deps: ISetupFilesDeps,
): Promise<boolean> => {
  if (!paths.length || paths.some((path) => path.startsWith('--'))) {
    throw new Error(USAGE);
  }

  let clean = true;

  for (const path of paths) {
    const content = deps.readFile(path);
    const check: ISetupFileCheck = content
      ? await checkSetupFile(content, basename(path), deps.today)
      : {
          kind: null,
          refusal: 'No such file.',
          rows: 0,
          problems: [],
          summary: [],
        };

    clean &&= check.kind !== null && check.problems.length === 0;
    report(path, check).forEach(deps.print);
  }

  return clean;
};
