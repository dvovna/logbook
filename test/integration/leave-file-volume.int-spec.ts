import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId } from './support/test-workspace';
import {
  historyCsv,
  leaveFileTexts,
  shareLeaveFile,
} from './support/leave-file';

const DAY_MS = 24 * 60 * 60 * 1000;
const PEOPLE = 30;

// Apply of a history file reads the workspace and writes its leaves in a few
// statements, whatever the number of rows: only the inserts grow, one per
// 2000 rows (a statement takes at most 65535 parameters).
describe('Leave history file of many rows', () => {
  let t: ITestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  // Shares a file of `count` one-day leaves of 30 people, applies it, and
  // returns its answer and the statements Apply sent.
  const applyFile = async (count: number) => {
    const workspace = await t.createWorkspace();
    const hr = await workspace.addUser({ role: UserRole.HR });
    const policy = await workspace.addVacationPolicy({ vacation_days: 26 });
    const team = await workspace.addTeam({ vacation_policy_id: policy.id });
    const people: Tables<'users'>[] = await t.db
      .insertInto('users')
      .values(
        Array.from({ length: PEOPLE }, (_, index) => ({
          slack_team_id: workspace.id,
          slack_id: slackId('U'),
          name: `Person ${index}`,
          email: `person-${index}@example.test`,
          role: UserRole.Member,
          team_id: team.id,
        })),
      )
      .returningAll()
      .execute();
    const lines = Array.from({ length: count }, (_, index) => {
      const { name, email } = people[index % PEOPLE];
      // Each person's leaves on days one after another, back from today.
      const day = new Date(Date.now() - Math.floor(index / PEOPLE) * DAY_MS)
        .toISOString()
        .slice(0, 10);

      return `${name},${email},Sick leave,${day},${day},`;
    });
    const [preview] = await shareLeaveFile(
      t,
      workspace,
      hr,
      historyCsv(...lines),
      'leave-history.csv',
    );
    const since = t.sql.mark();

    await t.slack.actOnMessage(workspace, hr, preview, 'apply').expect(200);
    await t.idle();

    return {
      result: leaveFileTexts(
        t.slackApi.messageUpdates(workspace.token, preview).pop(),
      ),
      statements: t.sql.statements(since).length,
      requests: (await workspace.rows('vacation_requests')).length,
    };
  };

  it('applies 3000 rows with the statements of 300 and one insert more', async () => {
    const few = await applyFile(300);
    const many = await applyFile(3000);

    expect(few.result).toEqual(['✅ Added 300 leaves for 30 people.']);
    expect(many.result).toEqual(['✅ Added 3000 leaves for 30 people.']);
    expect([few.requests, many.requests]).toEqual([300, 3000]);
    expect(many.statements).toBe(few.statements + 1);
  });
});
