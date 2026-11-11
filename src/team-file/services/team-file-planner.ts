import { createHash } from 'crypto';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
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

interface IUsableRow {
  row: ITeamFileRow;
  person: IUserViewModel;
  teamKey: string;
  isLead: boolean;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const normalizeTeam = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

const displayName = (row: ITeamFileRow) => row.name || row.email;

const readLead = (value: string): boolean | null => {
  const word = value.trim().toLowerCase();
  if (TEAM_FILE_LEAD_WORDS.includes(word)) return true;
  if (TEAM_FILE_NOT_LEAD_WORDS.includes(word)) return false;
  return null;
};

export function planTeamFile(
  rows: ITeamFileRow[],
  state: ITeamFileState,
  maxTeams: number,
): ITeamFilePlan {
  const peopleByEmail = new Map<string, IUserViewModel>();
  for (const person of state.people) {
    const email = normalizeEmail(person.email);
    if (!peopleByEmail.has(email)) peopleByEmail.set(email, person);
  }
  const teamsByKey = new Map(
    state.teams.map((team) => [normalizeTeam(team.name), team]),
  );
  const firstRowOfEmail = new Map<string, number>();
  const unusable = new Map<number, string>();
  const candidates: IUsableRow[] = [];

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const reason = (() => {
      if (!email) return REASONS.noEmail;
      const person = peopleByEmail.get(email);
      if (!person) return REASONS.notInWorkspace(row.email);
      if (!person.is_active) return REASONS.deactivated(displayName(row));
      const earlier = firstRowOfEmail.get(email);
      if (earlier !== undefined) return REASONS.duplicate(row.email, earlier);
      const isLead = readLead(row.lead);
      if (isLead === null) return REASONS.invalidLead;
      if (isLead && !normalizeTeam(row.team))
        return REASONS.leadWithoutTeam(displayName(row));
      if (isLead && [UserRole.HR, UserRole.Finance].includes(person.role))
        return REASONS.cannotLead(displayName(row), person.role);
      return null;
    })();

    if (email && peopleByEmail.has(email) && !firstRowOfEmail.has(email)) {
      firstRowOfEmail.set(email, row.row);
    }
    if (reason) {
      unusable.set(row.row, reason);
      continue;
    }
    candidates.push({
      row,
      person: peopleByEmail.get(email)!,
      teamKey: normalizeTeam(row.team),
      isLead: readLead(row.lead) === true,
    });
  }

  const newTeamNames = new Map<string, string>();
  for (const { row, teamKey } of candidates) {
    if (teamKey && !teamsByKey.has(teamKey) && !newTeamNames.has(teamKey)) {
      newTeamNames.set(teamKey, row.team.trim().replace(/\s+/g, ' '));
    }
  }
  const allowedNew = Math.max(0, maxTeams - state.teams.length);
  const keptNewKeys = new Set([...newTeamNames.keys()].slice(0, allowedNew));

  const usable: IUsableRow[] = [];
  for (const candidate of candidates) {
    const { teamKey } = candidate;
    if (teamKey && newTeamNames.has(teamKey) && !keptNewKeys.has(teamKey)) {
      unusable.set(
        candidate.row.row,
        REASONS.teamLimit(maxTeams, newTeamNames.get(teamKey)!),
      );
    } else {
      usable.push(candidate);
    }
  }

  const finalTeamOf = new Map<string, string>();
  const nameMatches = new Map<string, string>();
  for (const { person, teamKey, row } of usable) {
    finalTeamOf.set(person.id, teamKey);
    if (!teamKey) continue;
    const finalName =
      teamsByKey.get(teamKey)?.name ?? newTeamNames.get(teamKey)!;
    if (row.team !== finalName && !nameMatches.has(row.team)) {
      nameMatches.set(row.team, finalName);
    }
  }
  const leadsOf = (teamKey: string) =>
    usable.filter((u) => u.isLead && u.teamKey === teamKey);

  const createTeams = [...keptNewKeys].map((key) => ({
    key,
    name: newTeamNames.get(key)!,
    leadIds: leadsOf(key).map((u) => u.person.id),
    memberIds: usable.filter((u) => u.teamKey === key).map((u) => u.person.id),
  }));

  const assignments: ITeamFilePlan['assignments'] = [];
  for (const { person, teamKey } of usable) {
    const existing = teamsByKey.get(teamKey);
    const toTeamId = existing?.id ?? null;
    if (person.team_id === toTeamId && (!teamKey || existing)) continue;
    assignments.push({
      userId: person.id,
      fromTeamId: person.team_id,
      toTeamId,
      toTeamKey: teamKey && !existing ? teamKey : null,
    });
  }

  const touchedTeamIds = new Set<string>();
  for (const a of assignments) {
    if (a.fromTeamId) touchedTeamIds.add(a.fromTeamId);
    if (a.toTeamId) touchedTeamIds.add(a.toTeamId);
  }

  const leadChanges: ITeamFilePlan['leadChanges'] = [];
  const teamsWithoutLead: string[] = [];
  for (const team of state.teams) {
    const key = normalizeTeam(team.name);
    const approverSlackIds = new Set(team.manager_approvers ?? []);
    const isApprover = (p: IUserViewModel) => approverSlackIds.has(p.slack_id);
    const add = leadsOf(key)
      .map((u) => u.person)
      .filter((p) => !isApprover(p))
      .map((p) => p.id);
    const remove = state.people
      .filter(
        (p) =>
          isApprover(p) &&
          p.team_id === team.id &&
          finalTeamOf.has(p.id) &&
          !leadsOf(key).some((u) => u.person.id === p.id),
      )
      .map((p) => p.id);
    if (add.length || remove.length) {
      leadChanges.push({ teamId: team.id, add, remove });
      touchedTeamIds.add(team.id);
    }
    if (!touchedTeamIds.has(team.id)) continue;
    for (const id of remove) approverSlackIds.delete(byId(state, id).slack_id);
    for (const id of add) approverSlackIds.add(byId(state, id).slack_id);
    if (approverSlackIds.size === 0) teamsWithoutLead.push(team.name);
  }
  for (const created of createTeams) {
    if (created.leadIds.length === 0) teamsWithoutLead.push(created.name);
  }

  const promotions = usable
    .filter((u) => u.isLead && u.person.role === UserRole.Member)
    .map((u) => u.person.id);

  return {
    createTeams,
    assignments,
    leadChanges,
    promotions,
    nameMatches: [...nameMatches].map(([written, teamName]) => ({
      written,
      teamName,
    })),
    teamsWithoutLead,
    leftWithoutTeam: usable.filter((u) => !u.teamKey).map((u) => u.person.id),
    unusable: [...unusable]
      .sort(([a], [b]) => a - b)
      .map(([row, reason]) => ({ row, reason })),
  };
}

function byId(state: ITeamFileState, id: string): IUserViewModel {
  return state.people.find((p) => p.id === id)!;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
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
