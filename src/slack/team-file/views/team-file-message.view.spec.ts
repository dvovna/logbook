import { TeamFileMessageView } from '@modules/slack/team-file/views/team-file-message.view';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';
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

  describe('preview', () => {
    const view = new TeamFileMessageView();
    const companyRules = (hrApprovers: string[]) =>
      ({
        hr_approvers: hrApprovers,
        hr_approvers_rule: ApprovalRule.Any,
        approval_notification_recipients: [],
        vacation_policy: null,
      }) as unknown as IRuleSetViewModel;
    const newTeamLine = (hrApprovers: string[]) => {
      const [, created] = view.preview(
        plan({
          createTeams: [
            { key: 'ops', name: 'Ops', leadIds: [], memberIds: ['Ann'] },
          ],
        }),
        names,
        companyRules(hrApprovers),
        'upload-1',
        'team.csv',
      ) as { text: { text: string } }[];

      return created.text.text;
    };

    it('sends the requests of a new team with no lead to the second approval the company rules name', () => {
      expect(newTeamLine(['UHR'])).toBe(
        '*Teams to create (1)*\n• *Ops*: 1 person, no lead, so requests go straight to the second approval',
      );
    });

    it('sends them to HR or an admin when the company rules name no second approval', () => {
      expect(newTeamLine([])).toBe(
        '*Teams to create (1)*\n• *Ops*: 1 person, no lead, so requests go to HR or an admin',
      );
    });
  });

  describe('undone', () => {
    const view = new TeamFileMessageView();
    const texts = (message: { blocks: unknown[] }) =>
      (message.blocks as { text: { text: string } }[]).map((b) => b.text.text);

    it('says only the count when nothing was kept', () => {
      expect(view.undone(3, [])).toEqual({
        text: '↩️ Undone: 3 changes restored.',
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: '↩️ Undone: 3 changes restored.' },
          },
        ],
      });
    });

    it('lists 10 kept items, escaped, then counts the rest', () => {
      const kept = Array.from({ length: 12 }, (_, i) =>
        i === 0 ? '<!here> kept' : `item ${i}`,
      );

      const message = view.undone(1, kept);

      expect(message.text).toBe('↩️ Undone: 1 change restored.');
      expect(texts(message)).toEqual([
        [
          '↩️ Undone: 1 change restored.',
          'Kept as they are:',
          '• &lt;!here&gt; kept',
          ...Array.from({ length: 9 }, (_, i) => `• item ${i + 1}`),
          '…and 2 more',
        ].join('\n'),
      ]);
    });
  });
});
