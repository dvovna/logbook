import { BadRequestException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { IUserViewModel } from '@modules/users/types/user.interface';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { envSchema } from 'src/env.schema';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { parseLeaveFile } from 'src/leave-file/parsers/leave-file.parser';
import { planLeaveBalances } from 'src/leave-file/services/leave-balances-planner';
import { planLeaveHistory } from 'src/leave-file/services/leave-history-planner';
import {
  ILeaveBalanceRow,
  ILeaveHistoryRow,
} from 'src/leave-file/types/leave-file-row.interface';
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';
import { planTeamFile } from 'src/team-file/services/team-file-planner';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';

export type SetupFileKind = 'team' | 'balances' | 'history';

export interface ISetupFileCheck {
  // Null for a file Logbook would not take at all, with `refusal` saying why.
  kind: SetupFileKind | null;
  refusal?: string;
  rows: number;
  // The rows Logbook would list as unusable, with its own words.
  problems: { row: number; reason: string }[];
  // What Logbook would make of the other rows.
  summary: string[];
}

// As FileUploadService takes them.
const MAX_FILE_BYTES = 1024 * 1024;
const SPREADSHEET_NAME = /\.(csv|xlsx)$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const UNKNOWN_FILE =
  'Not a file Logbook reads. A team file needs Email and Team columns; leave balances need Email and Days left, Working days left, Bonus days left or Contract start (and no Team); a leave history needs Email, Leave type, From and To.';

const limits = envSchema
  .pick({ MAX_TEAMS_PER_SLACK_TEAM: true, MAX_REQUESTS_PER_USER: true })
  .parse({});

const count = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

// The check knows no workspace: every email of the file stands for an active
// member in no team, of a workspace with no teams, requests or balances.
// What is left of the planners' refusals is what the file itself gets wrong.
const peopleOf = (rows: { email: string }[], today: string): IUserViewModel[] =>
  [...new Set(rows.map(({ email }) => email.trim().toLowerCase()))]
    .filter(Boolean)
    .map((email) => ({
      id: email,
      email,
      name: email,
      role: UserRole.Member,
      is_active: true,
      contract_start_date: null,
      carryover_days: null,
      team_id: null,
      slack_team_id: 'check',
      slack_id: email,
      created_at: `${today}T00:00:00.000Z`,
    }));

const POLICY: IVacationPolicyViewModel = {
  id: 'check',
  name: 'check',
  slack_team_id: 'check',
  working_days: 0,
  vacation_days: 0,
  carryover_days: 0,
  bonus_days: 0,
  created_at: '',
  updated_at: '',
  created_by: null,
  updated_by: null,
};

const badEmails = (rows: { row: number; email: string }[]) =>
  rows
    .filter(({ email }) => email.trim() && !EMAIL.test(email.trim()))
    .map(({ row, email }) => ({
      row,
      reason: `"${email.trim()}" is not an email address`,
    }));

// One reason a row, the file's own first.
const problemsOf = (
  ...lists: { row: number; reason: string }[][]
): ISetupFileCheck['problems'] => {
  const byRow = new Map<number, string>();

  for (const { row, reason } of lists.flat()) {
    if (!byRow.has(row)) byRow.set(row, reason);
  }

  return [...byRow]
    .sort(([a], [b]) => a - b)
    .map(([row, reason]) => ({ row, reason }));
};

const checkTeamFile = (rows: ITeamFileRow[], today: string) => {
  const plan = planTeamFile(
    rows,
    { people: peopleOf(rows, today), teams: [] },
    limits.MAX_TEAMS_PER_SLACK_TEAM,
  );
  const summary = plan.createTeams.map(
    ({ name, memberIds, leadIds }) =>
      `Team "${name}": ${count(memberIds.length, 'person', 'people')}, ${
        leadIds.length ? count(leadIds.length, 'lead') : 'no lead'
      }`,
  );

  if (plan.leftWithoutTeam.length) {
    summary.push(
      `${count(plan.leftWithoutTeam.length, 'person', 'people')} with an empty Team: they leave their team`,
    );
  }

  for (const { written, teamName } of plan.nameMatches) {
    summary.push(`"${written}" is read as the team "${teamName}"`);
  }

  if (plan.teamsWithoutLead.length) {
    summary.push(
      `No lead in the file: ${plan.teamsWithoutLead.join(', ')}. A team that exists keeps the leads it has; a new one has nobody at level 1 until it gets one.`,
    );
  }

  return { problems: problemsOf(badEmails(rows), plan.unusable), summary };
};

const checkBalances = (rows: ILeaveBalanceRow[], today: string) => {
  const people = peopleOf(rows, today);
  const plan = planLeaveBalances(rows, {
    today,
    people,
    policyOf: new Map(people.map(({ id }) => [id, POLICY])),
    requestsOf: new Map(),
    balanceOf: new Map(),
  });
  const summary = [
    `${count(plan.balances.length, 'balance')} to set`,
    `${count(plan.contractStarts.length, 'contract start')} to set`,
  ];

  if (plan.unchanged) {
    summary.push(
      `${count(plan.unchanged, 'row')} with no count and no contract start: nothing to set`,
    );
  }

  return { problems: problemsOf(badEmails(rows), plan.unusable), summary };
};

const checkHistory = (rows: ILeaveHistoryRow[], today: string) => {
  const plan = planLeaveHistory(rows, {
    today,
    maxRequestsPerUser: limits.MAX_REQUESTS_PER_USER,
    requestCountOf: new Map(),
    people: peopleOf(rows, today),
    policyOf: new Map(),
    requestsOf: new Map(),
    balanceOf: new Map(),
    workingDatesOf: () => [],
  });
  const people = new Set(plan.add.map(({ userId }) => userId)).size;

  return {
    problems: problemsOf(badEmails(rows), plan.unusable),
    summary: [
      `${count(plan.add.length, 'leave')} to add for ${count(people, 'person', 'people')}`,
    ],
  };
};

// Reads a file as Logbook would on receiving it, without a workspace: which
// of the three files it is, and the rows it could not use whoever is in the
// workspace. `today` is YYYY-MM-DD.
export const checkSetupFile = async (
  content: Buffer,
  fileName: string,
  today: string,
): Promise<ISetupFileCheck> => {
  const refused = (refusal: string): ISetupFileCheck => ({
    kind: null,
    refusal,
    rows: 0,
    problems: [],
    summary: [],
  });

  if (!SPREADSHEET_NAME.test(fileName)) {
    return refused('The file name must end in .csv or .xlsx.');
  }

  if (content.length > MAX_FILE_BYTES) {
    return refused('The file is larger than 1 MB.');
  }

  try {
    const lines = await readSpreadsheet(content, fileName);
    // The order FileUploadService tells them apart in.
    const leaveFile = parseLeaveFile(lines);
    const teamRows =
      leaveFile?.kind === LeaveFileKind.History ? null : parseTeamFile(lines);

    if (teamRows) {
      return {
        kind: 'team',
        rows: teamRows.length,
        ...checkTeamFile(teamRows, today),
      };
    }

    if (!leaveFile) {
      return refused(UNKNOWN_FILE);
    }

    return leaveFile.kind === LeaveFileKind.History
      ? {
          kind: 'history',
          rows: leaveFile.rows.length,
          ...checkHistory(leaveFile.rows, today),
        }
      : {
          kind: 'balances',
          rows: leaveFile.rows.length,
          ...checkBalances(leaveFile.rows, today),
        };
  } catch (error) {
    if (!(error instanceof BadRequestException)) {
      throw error;
    }

    return refused(error.message);
  }
};
