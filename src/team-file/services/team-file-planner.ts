import { createHash } from 'crypto';
import UserRole from '@common/enums/user-role.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TEAM_FILE_CANNOT_LEAD_ROLE_LABELS } from 'src/team-file/constants/team-file-lead-roles';
import {
  TEAM_FILE_LEAD_WORDS,
  TEAM_FILE_NOT_LEAD_WORDS,
} from 'src/team-file/constants/team-file-lead-words';
import { TEAM_FILE_UNUSABLE_REASONS as REASONS } from 'src/team-file/constants/team-file-unusable-reasons';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import { IUsableTeamFileRow } from 'src/team-file/types/team-file-usable-row.interface';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const collapseSpaces = (name: string) => name.trim().replace(/\s+/g, ' ');
const normalizeTeam = (name: string) => collapseSpaces(name).toLowerCase();
const displayName = (row: ITeamFileRow) => row.name || row.email;

const readLead = (value: string): boolean | null => {
  const word = value.trim().toLowerCase();
  if (TEAM_FILE_LEAD_WORDS.includes(word)) return true;
  if (TEAM_FILE_NOT_LEAD_WORDS.includes(word)) return false;
  return null;
};

type TeamMatch =
  | { kind: 'none' }
  | { kind: 'ambiguous' }
  | { kind: 'team'; team: ITeamViewModel };

// An exact spelling wins over the case-insensitive match (D4); several
// case-insensitive matches and no exact one can't be told apart.
function matchTeam(written: string, teams: ITeamViewModel[]): TeamMatch {
  const exact = teams.find((t) => collapseSpaces(t.name) === written);
  if (exact) return { kind: 'team', team: exact };
  const key = normalizeTeam(written);
  const matches = teams.filter((t) => normalizeTeam(t.name) === key);
  if (matches.length > 1) return { kind: 'ambiguous' };
  return matches.length ? { kind: 'team', team: matches[0] } : { kind: 'none' };
}

function indexPeopleByEmail(people: IUserViewModel[]) {
  const byEmail = new Map<string, IUserViewModel>();
  for (const person of people) {
    const email = normalizeEmail(person.email);
    const known = byEmail.get(email);
    if (!known || (!known.is_active && person.is_active)) {
      byEmail.set(email, person);
    }
  }
  return byEmail;
}

function checkRows(
  rows: ITeamFileRow[],
  state: ITeamFileState,
  unusable: Map<number, string>,
): IUsableTeamFileRow[] {
  const peopleByEmail = indexPeopleByEmail(state.people);
  const firstRowOfEmail = new Map<string, number>();
  const checked: IUsableTeamFileRow[] = [];

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const person = peopleByEmail.get(email);
    const written = collapseSpaces(row.team);
    const isLead = readLead(row.lead);
    const match = written ? matchTeam(written, state.teams) : null;
    const earlier = firstRowOfEmail.get(email);
    if (person && earlier === undefined) firstRowOfEmail.set(email, row.row);

    const reason = (() => {
      if (!email) return REASONS.noEmail;
      if (!person) return REASONS.notInWorkspace(row.email);
      if (!person.is_active) return REASONS.deactivated(displayName(row));
      if (earlier !== undefined) return REASONS.duplicate(row.email, earlier);
      if (isLead === null) return REASONS.invalidLead;
      if (isLead && !written) return REASONS.leadWithoutTeam(displayName(row));
      const roleLabel = TEAM_FILE_CANNOT_LEAD_ROLE_LABELS[person.role];
      if (isLead && roleLabel)
        return REASONS.cannotLead(displayName(row), roleLabel);
      if (match?.kind === 'ambiguous') return REASONS.ambiguousTeam(written);
      return null;
    })();

    if (reason || !person) {
      unusable.set(row.row, reason!);
      continue;
    }
    checked.push({
      row,
      person,
      team: match?.kind === 'team' ? match.team : null,
      newKey: match?.kind === 'none' ? normalizeTeam(written) : '',
      written,
      isLead: isLead === true,
    });
  }
  return checked;
}

function cutOverLimit(
  checked: IUsableTeamFileRow[],
  existingCount: number,
  maxTeams: number,
  unusable: Map<number, string>,
) {
  const firstSpelling = new Map<string, string>();
  for (const { newKey, written } of checked) {
    if (newKey && !firstSpelling.has(newKey))
      firstSpelling.set(newKey, written);
  }
  const allowed = Math.max(0, maxTeams - existingCount);
  const kept = new Map([...firstSpelling].slice(0, allowed));

  const usable: IUsableTeamFileRow[] = [];
  for (const item of checked) {
    if (item.newKey && !kept.has(item.newKey)) {
      unusable.set(
        item.row.row,
        REASONS.teamLimit(maxTeams, firstSpelling.get(item.newKey)!),
      );
    } else {
      usable.push(item);
    }
  }
  return { usable, newTeamNames: kept };
}

function planAssignments(usable: IUsableTeamFileRow[]) {
  const assignments: ITeamFilePlan['assignments'] = [];
  for (const { person, team, newKey } of usable) {
    const toTeamId = team?.id ?? null;
    if (person.team_id === toTeamId && !newKey) continue;
    assignments.push({
      userId: person.id,
      fromTeamId: person.team_id,
      toTeamId,
      toTeamKey: newKey || null,
    });
  }
  return assignments;
}

function planLeadChanges(
  state: ITeamFileState,
  usable: IUsableTeamFileRow[],
  assignments: ITeamFilePlan['assignments'],
  createdWithoutLead: string[],
) {
  const peopleById = new Map(state.people.map((p) => [p.id, p]));
  const inFile = new Map(usable.map((u) => [u.person.id, u]));
  const touched = new Set<string>();
  for (const a of assignments) {
    if (a.fromTeamId) touched.add(a.fromTeamId);
    if (a.toTeamId) touched.add(a.toTeamId);
  }

  const leadChanges: ITeamFilePlan['leadChanges'] = [];
  const teamsWithoutLead: string[] = [];
  for (const team of state.teams) {
    const approvers = new Set(team.manager_approvers ?? []);
    const leadIds = new Set(
      usable
        .filter((u) => u.isLead && u.team?.id === team.id)
        .map((u) => u.person.id),
    );
    const add = [...leadIds].filter(
      (id) => !approvers.has(peopleById.get(id)!.slack_id),
    );
    const remove = state.people
      .filter(
        (p) =>
          approvers.has(p.slack_id) &&
          p.team_id === team.id &&
          inFile.has(p.id) &&
          !leadIds.has(p.id),
      )
      .map((p) => p.id);
    if (add.length || remove.length) {
      leadChanges.push({ teamId: team.id, add, remove });
      touched.add(team.id);
    }
    if (!touched.has(team.id)) continue;
    for (const id of remove) approvers.delete(peopleById.get(id)!.slack_id);
    for (const id of add) approvers.add(peopleById.get(id)!.slack_id);
    if (approvers.size === 0) teamsWithoutLead.push(team.name);
  }
  return {
    leadChanges,
    teamsWithoutLead: [...teamsWithoutLead, ...createdWithoutLead],
  };
}

function planNameMatches(
  usable: IUsableTeamFileRow[],
  newTeamNames: Map<string, string>,
) {
  const matches = new Map<string, string>();
  for (const { row, team, newKey, written } of usable) {
    const teamName = team ? team.name : newTeamNames.get(newKey);
    if (teamName === undefined || written === teamName) continue;
    if (!matches.has(row.team.trim())) matches.set(row.team.trim(), teamName);
  }
  return [...matches].map(([written, teamName]) => ({ written, teamName }));
}

export function planTeamFile(
  rows: ITeamFileRow[],
  state: ITeamFileState,
  maxTeams: number,
): ITeamFilePlan {
  const unusable = new Map<number, string>();
  const { usable, newTeamNames } = cutOverLimit(
    checkRows(rows, state, unusable),
    state.teams.length,
    maxTeams,
    unusable,
  );

  const createTeams = [...newTeamNames].map(([key, name]) => ({
    key,
    name,
    leadIds: usable
      .filter((u) => u.isLead && u.newKey === key)
      .map((u) => u.person.id),
    memberIds: usable.filter((u) => u.newKey === key).map((u) => u.person.id),
  }));
  const assignments = planAssignments(usable);
  const { leadChanges, teamsWithoutLead } = planLeadChanges(
    state,
    usable,
    assignments,
    createTeams.filter((t) => t.leadIds.length === 0).map((t) => t.name),
  );

  return {
    createTeams,
    assignments,
    leadChanges,
    promotions: usable
      .filter((u) => u.isLead && u.person.role === UserRole.Member)
      .map((u) => u.person.id),
    nameMatches: planNameMatches(usable, newTeamNames),
    teamsWithoutLead,
    leftWithoutTeam: usable
      .filter((u) => !u.team && !u.newKey)
      .map((u) => u.person.id),
    unusable: [...unusable]
      .sort(([a], [b]) => a - b)
      .map(([row, reason]) => ({ row, reason })),
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => compare(a, b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  }
  return value;
}

export function planDigest(plan: ITeamFilePlan): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(plan)))
    .digest('hex');
}
