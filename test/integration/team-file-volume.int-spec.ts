import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { messageTexts, shareTeamFile, teamFileCsv } from './support/team-file';

// Apply writes a file in one transaction whose statements depend on the
// teams it creates and changes, not on the people it places: those move in
// one statement per team. Each person placed closes their open team
// questions after it, one statement each, in the background.
describe('Team file of many people', () => {
  let t: ITestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  // Shares a file that places `count` people in two new teams with a lead
  // each, applies it, and returns its answer and the statements Apply sent.
  const applyFile = async (count: number) => {
    const workspace: TestWorkspace = await t.createWorkspace();
    const hr = await workspace.addUser({ role: UserRole.HR });
    const people: Tables<'users'>[] = await t.db
      .insertInto('users')
      .values(
        Array.from({ length: count }, (_, index) => ({
          slack_team_id: workspace.id,
          slack_id: slackId('U'),
          name: `Person ${index}`,
          email: `person-${index}@example.test`,
          role: UserRole.Member,
        })),
      )
      .returningAll()
      .execute();
    const [preview] = await shareTeamFile(
      t,
      workspace,
      hr,
      teamFileCsv(
        ...people.map(
          ({ name, email }, index) =>
            `${name},${email},${index % 2 ? 'Acme' : 'Beta'},${index < 2 ? 'yes' : ''}`,
        ),
      ),
    );
    const since = t.sql.mark();

    await t.slack.actOnMessage(workspace, hr, preview, 'apply').expect(200);
    await t.idle();

    const sent = t.sql.statements(since).map(({ text }) => text);
    const closingQuestions = sent.filter((text) =>
      text.startsWith('update "new_person_prompts"'),
    );

    return {
      result: messageTexts(
        t.slackApi.messageUpdates(workspace.token, preview).pop(),
      ),
      closingQuestions: closingQuestions.length,
      others: sent.length - closingQuestions.length,
    };
  };

  it('places hundreds of people with the statements of a few', async () => {
    const few = await applyFile(3);
    const many = await applyFile(300);

    expect(few.result).toEqual([
      '✅ Created 2 teams, placed 3 people and made 2 people Managers.',
    ]);
    expect(many.result).toEqual([
      '✅ Created 2 teams, placed 300 people and made 2 people Managers.',
    ]);
    expect(many.others).toBeLessThanOrEqual(few.others);
    expect([few.closingQuestions, many.closingQuestions]).toEqual([3, 300]);
  });
});
