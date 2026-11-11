import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { ITeamFilePlan } from 'src/team-file/types/team-file-plan.interface';

const plan = (fields: Partial<ITeamFilePlan>): ITeamFilePlan => ({
  createTeams: [],
  assignments: [],
  leadChanges: [],
  promotions: [],
  nameMatches: [],
  teamsWithoutLead: [],
  leftWithoutTeam: [],
  unusable: [],
  ...fields,
});

const names = new Map(
  ['Ann', 'Bo', 'Cy', 'Dee', 'Eve <!here>'].map((name) => [name, name]),
);

describe('TeamFileMessageView', () => {
  describe('appliedText', () => {
    const view = new TeamFileMessageView();

    it('counts in plurals and names three people without a team, then counts the rest', () => {
      expect(
        view.appliedText(
          plan({
            createTeams: [
              { key: 'a', name: 'A', leadIds: [], memberIds: [] },
              { key: 'b', name: 'B', leadIds: [], memberIds: [] },
            ],
            assignments: [
              { userId: 'x', fromTeamId: null, toTeamId: 't', toTeamKey: null },
              { userId: 'y', fromTeamId: 't', toTeamId: null, toTeamKey: 'a' },
              { userId: 'z', fromTeamId: 't', toTeamId: null, toTeamKey: null },
              { userId: 'w', fromTeamId: 'u', toTeamId: null, toTeamKey: null },
            ],
            leadChanges: [{ teamId: 't', add: ['x', 'y'], remove: ['z', 'w'] }],
            promotions: ['x', 'y'],
            leftWithoutTeam: ['Ann', 'Bo', 'Cy', 'Dee', 'Eve <!here>'],
          }),
          names,
        ),
      ).toBe(
        '✅ Created 2 teams, placed 2 people, took 2 people out of their teams, added 2 leads, removed 2 leads and made 2 people Managers. Ann, Bo, Cy and 2 more have no team yet.',
      );
    });

    it('names two people without a team, escaped', () => {
      expect(
        view.appliedText(
          plan({
            assignments: [
              { userId: 'x', fromTeamId: 't', toTeamId: null, toTeamKey: null },
            ],
            leftWithoutTeam: ['Ann', 'Eve <!here>'],
          }),
          names,
        ),
      ).toBe(
        '✅ Took 1 person out of a team. Ann and Eve &lt;!here&gt; have no team yet.',
      );
    });
  });
});
