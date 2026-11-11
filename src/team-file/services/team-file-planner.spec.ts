import UserRole from '@common/enums/user-role.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  planDigest,
  planTeamFile,
} from 'src/team-file/services/team-file-planner';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';
import {
  ITeamFilePlan,
  ITeamFileState,
} from 'src/team-file/types/team-file-plan.interface';

const person = (
  id: string,
  overrides: Partial<IUserViewModel> = {},
): IUserViewModel => ({
  id,
  email: `${id}@company.io`,
  name: id.toUpperCase(),
  role: UserRole.Member,
  is_active: true,
  team_id: null,
  slack_team_id: 'st',
  slack_id: `S${id}`,
  created_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const team = (
  id: string,
  name: string,
  approvers: string[] | null = null,
): ITeamViewModel => ({
  id,
  name,
  description: '',
  vacation_policy_id: null,
  rule_set_id: null,
  vacation_policy: null,
  manager_approvers: approvers,
  hr_approvers: null,
  approval_notification_recipients: null,
  manager_approvers_rule: ApprovalRule.Any,
  hr_approvers_rule: ApprovalRule.Any,
  slack_team_id: 'st',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  created_by: null,
  updated_by: null,
});

const row = (
  n: number,
  email: string,
  teamName = '',
  lead = '',
  name = '',
): ITeamFileRow => ({ row: n, name, email, team: teamName, lead });

const emptyPlan: ITeamFilePlan = {
  createTeams: [],
  assignments: [],
  leadChanges: [],
  promotions: [],
  nameMatches: [],
  teamsWithoutLead: [],
  leftWithoutTeam: [],
  unusable: [],
};

const plan = (
  rows: ITeamFileRow[],
  state: Partial<ITeamFileState>,
  maxTeams = 50,
) => planTeamFile(rows, { people: [], teams: [], ...state }, maxTeams);

describe('planTeamFile', () => {
  it('matches " Anna@Company.io " to anna@company.io', () => {
    const anna = person('anna');

    expect(
      plan([row(2, ' Anna@Company.io ', 'Sales')], { people: [anna] }),
    ).toEqual({
      ...emptyPlan,
      createTeams: [
        { key: 'sales', name: 'Sales', leadIds: [], memberIds: ['anna'] },
      ],
      assignments: [
        {
          userId: 'anna',
          fromTeamId: null,
          toTeamId: null,
          toTeamKey: 'sales',
        },
      ],
      teamsWithoutLead: ['Sales'],
    });
  });

  it('marks the second row of an email as already on the first', () => {
    const anna = person('anna');

    expect(
      plan(
        [row(2, 'anna@company.io', 'Sales'), row(3, 'ANNA@company.io', 'Ops')],
        {
          people: [anna],
        },
      ).unusable,
    ).toEqual([{ row: 3, reason: 'ANNA@company.io is already on row 2' }]);
  });

  it('matches "acme  corp" to the existing "Acme Corp" and reports it', () => {
    const acme = team('t1', 'Acme Corp', ['Sbob']);
    const bob = person('bob', { team_id: 't1' });
    const anna = person('anna');

    expect(
      plan([row(2, 'anna@company.io', 'acme  corp')], {
        people: [anna, bob],
        teams: [acme],
      }),
    ).toEqual({
      ...emptyPlan,
      assignments: [
        { userId: 'anna', fromTeamId: null, toTeamId: 't1', toTeamKey: null },
      ],
      nameMatches: [{ written: 'acme  corp', teamName: 'Acme Corp' }],
    });
  });

  it('names a new team by its first spelling and reports other spellings once', () => {
    const state = { people: [person('a'), person('b'), person('c')] };

    expect(
      plan(
        [
          row(2, 'a@company.io', 'Dev Ops', 'yes'),
          row(3, 'b@company.io', 'dev ops'),
          row(4, 'c@company.io', 'dev ops'),
        ],
        state,
      ),
    ).toEqual({
      ...emptyPlan,
      createTeams: [
        {
          key: 'dev ops',
          name: 'Dev Ops',
          leadIds: ['a'],
          memberIds: ['a', 'b', 'c'],
        },
      ],
      assignments: ['a', 'b', 'c'].map((userId) => ({
        userId,
        fromTeamId: null,
        toTeamId: null,
        toTeamKey: 'dev ops',
      })),
      promotions: ['a'],
      nameMatches: [{ written: 'dev ops', teamName: 'Dev Ops' }],
    });
  });

  it.each(['yes', 'Y', 'x', 'TRUE', '1'])('reads %s as lead', (word) => {
    const result = plan([row(2, 'a@company.io', 'Ops', word)], {
      people: [person('a', { role: UserRole.Manager })],
    });

    expect(result.createTeams[0].leadIds).toEqual(['a']);
    expect(result.promotions).toEqual([]);
  });

  it('reads an empty cell and no as not a lead', () => {
    const result = plan(
      [row(2, 'a@company.io', 'Ops', 'no'), row(3, 'b@company.io', 'Ops', '')],
      { people: [person('a'), person('b')] },
    );

    expect(result.createTeams[0].leadIds).toEqual([]);
    expect(result.unusable).toEqual([]);
  });

  it('refuses any other lead value', () => {
    expect(
      plan([row(2, 'a@company.io', 'Ops', 'maybe')], { people: [person('a')] }),
    ).toEqual({
      ...emptyPlan,
      unusable: [{ row: 2, reason: 'Team lead must be yes or empty' }],
    });
  });

  it('promotes a Member lead and keeps Admin and Manager', () => {
    const result = plan(
      [
        row(2, 'm@company.io', 'Ops', 'yes'),
        row(3, 'a@company.io', 'Ops', 'yes'),
        row(4, 'g@company.io', 'Ops', 'yes'),
      ],
      {
        people: [
          person('m'),
          person('a', { role: UserRole.Admin }),
          person('g', { role: UserRole.Manager }),
        ],
      },
    );

    expect(result.promotions).toEqual(['m']);
  });

  it.each([
    [UserRole.HR, 'hr'],
    [UserRole.Finance, 'finance'],
  ])('makes a lead with the %s role unusable', (role) => {
    expect(
      plan([row(2, 'a@company.io', 'Ops', 'yes', 'Ann')], {
        people: [person('a', { role })],
      }),
    ).toEqual({
      ...emptyPlan,
      unusable: [
        {
          row: 2,
          reason: `Ann has the ${role} role, which can't approve at level 1`,
        },
      ],
    });
  });

  it('lets an HR person sit in a team without leading it', () => {
    const result = plan([row(2, 'a@company.io', 'Ops')], {
      people: [person('a', { role: UserRole.HR })],
    });

    expect(result.unusable).toEqual([]);
    expect(result.createTeams[0].memberIds).toEqual(['a']);
  });

  it('refuses a lead with no team and uses the email when the name is empty', () => {
    expect(
      plan([row(2, 'a@company.io', '', 'yes')], { people: [person('a')] })
        .unusable,
    ).toEqual([
      { row: 2, reason: 'a@company.io is marked as lead but has no team' },
    ]);
  });

  it('refuses people who are not in the workspace or are deactivated', () => {
    expect(
      plan(
        [
          row(2, 'ghost@company.io', 'Ops'),
          row(3, 'a@company.io', 'Ops', '', 'Ann'),
        ],
        { people: [person('a', { is_active: false })] },
      ).unusable,
    ).toEqual([
      { row: 2, reason: "ghost@company.io isn't in this Slack workspace" },
      { row: 3, reason: 'Ann is deactivated' },
    ]);
  });

  it('refuses a row with no email', () => {
    expect(plan([row(2, '', 'Ops', '', 'Ann')], {}).unusable).toEqual([
      { row: 2, reason: 'Row has no email' },
    ]);
  });

  it('a refused row contributes nothing', () => {
    expect(
      plan([row(2, 'a@company.io', 'Ops', 'yes', 'Ann')], {
        people: [person('a', { role: UserRole.HR })],
      }).createTeams,
    ).toEqual([]);
  });

  it('moves a person out of a team and lists who is left without a team', () => {
    const ops = team('t1', 'Ops');

    expect(
      plan([row(2, 'a@company.io')], {
        people: [person('a', { team_id: 't1' }), person('b')],
        teams: [ops],
      }),
    ).toEqual({
      ...emptyPlan,
      assignments: [
        { userId: 'a', fromTeamId: 't1', toTeamId: null, toTeamKey: null },
      ],
      leftWithoutTeam: ['a'],
      teamsWithoutLead: ['Ops'],
    });
  });

  it('lists only people whose team changes', () => {
    const ops = team('t1', 'Ops', ['Sa']);

    expect(
      plan([row(2, 'a@company.io', 'ops', 'yes')], {
        people: [person('a', { team_id: 't1', role: UserRole.Manager })],
        teams: [ops],
      }),
    ).toEqual({
      ...emptyPlan,
      nameMatches: [{ written: 'ops', teamName: 'Ops' }],
    });
  });

  it('adds a lead to an existing team and promotes them', () => {
    const ops = team('t1', 'Ops');

    expect(
      plan([row(2, 'a@company.io', 'Ops', 'yes')], {
        people: [person('a')],
        teams: [ops],
      }),
    ).toEqual({
      ...emptyPlan,
      assignments: [
        { userId: 'a', fromTeamId: null, toTeamId: 't1', toTeamKey: null },
      ],
      leadChanges: [{ teamId: 't1', add: ['a'], remove: [] }],
      promotions: ['a'],
    });
  });

  it('removes a lead the file moves to another team and keeps a non-member approver', () => {
    const ops = team('t1', 'Ops', ['Sa', 'Sguest', 'Sunknown']);
    const dev = team('t2', 'Dev', ['Sd']);
    const people = [
      person('a', { team_id: 't1', role: UserRole.Manager }),
      person('guest', { role: UserRole.Manager }),
      person('d', { team_id: 't2', role: UserRole.Manager }),
      person('x', { team_id: 't1' }),
    ];

    expect(
      plan(
        [
          row(2, 'a@company.io', 'Dev'),
          row(3, 'guest@company.io', 'Dev'),
          row(4, 'd@company.io', 'Dev', 'yes'),
        ],
        { people, teams: [ops, dev] },
      ),
    ).toEqual({
      ...emptyPlan,
      assignments: [
        { userId: 'a', fromTeamId: 't1', toTeamId: 't2', toTeamKey: null },
        { userId: 'guest', fromTeamId: null, toTeamId: 't2', toTeamKey: null },
      ],
      leadChanges: [{ teamId: 't1', add: [], remove: ['a'] }],
    });
  });

  it('removes a member approver who stays in the team without yes', () => {
    const ops = team('t1', 'Ops', ['Sa', 'Sb']);

    expect(
      plan(
        [row(2, 'a@company.io', 'Ops'), row(3, 'b@company.io', 'Ops', 'yes')],
        {
          people: [
            person('a', { team_id: 't1', role: UserRole.Manager }),
            person('b', { team_id: 't1', role: UserRole.Manager }),
          ],
          teams: [ops],
        },
      ).leadChanges,
    ).toEqual([{ teamId: 't1', add: [], remove: ['a'] }]);
  });

  it('lists a changed team that ends with no lead and not an untouched one', () => {
    const ops = team('t1', 'Ops', ['Sa']);
    const quiet = team('t2', 'Quiet');

    expect(
      plan([row(2, 'a@company.io')], {
        people: [person('a', { team_id: 't1', role: UserRole.Manager })],
        teams: [ops, quiet],
      }).teamsWithoutLead,
    ).toEqual(['Ops']);
  });

  it('leaves people who are not in the file alone', () => {
    const ops = team('t1', 'Ops', ['Sa']);

    expect(
      plan([row(2, 'b@company.io', 'Ops')], {
        people: [
          person('a', { team_id: 't1', role: UserRole.Manager }),
          person('b'),
          person('c', { team_id: 't1' }),
        ],
        teams: [ops],
      }),
    ).toEqual({
      ...emptyPlan,
      assignments: [
        { userId: 'b', fromTeamId: null, toTeamId: 't1', toTeamKey: null },
      ],
    });
  });

  it('cuts the new teams that come last when the limit is reached', () => {
    const result = plan(
      [
        row(2, 'a@company.io', 'One'),
        row(3, 'b@company.io', 'Two'),
        row(4, 'c@company.io', 'two'),
        row(5, 'd@company.io', 'Three'),
        row(6, 'e@company.io', 'One'),
      ],
      {
        people: ['a', 'b', 'c', 'd', 'e'].map((id) => person(id)),
        teams: [team('t1', 'Existing')],
      },
      3,
    );

    expect(result.createTeams.map((t) => t.name)).toEqual(['One', 'Two']);
    expect(result.unusable).toEqual([
      { row: 5, reason: 'Logbook allows 3 teams; Three would be one more' },
    ]);
  });
});

describe('planDigest', () => {
  it('the digest is the same for the same plan in another order', () => {
    const a: ITeamFilePlan = {
      ...emptyPlan,
      promotions: ['x', 'y'],
      leadChanges: [
        { teamId: 't1', add: ['a', 'b'], remove: [] },
        { teamId: 't2', add: [], remove: ['c'] },
      ],
    };
    const b: ITeamFilePlan = {
      leadChanges: [
        { remove: ['c'], add: [], teamId: 't2' },
        { remove: [], add: ['b', 'a'], teamId: 't1' },
      ],
      promotions: ['y', 'x'],
      unusable: [],
      leftWithoutTeam: [],
      teamsWithoutLead: [],
      nameMatches: [],
      assignments: [],
      createTeams: [],
    };

    expect(planDigest(a)).toBe(planDigest(b));
    expect(planDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for a different plan', () => {
    expect(planDigest(emptyPlan)).not.toBe(
      planDigest({ ...emptyPlan, promotions: ['x'] }),
    );
  });
});
