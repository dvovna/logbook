import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { sectionTexts } from './support/tab-readers';
import { textOf } from './support/block-kit';
import { workWeek } from './support/dates';
import { requestVacation } from './support/vacation-flows';

const PEOPLE = 300;

const HEADER = [
  'email',
  'contractStartDate',
  ...[0, 1].flatMap((i) =>
    ['startDate', 'endDate', 'type', 'status'].map(
      (field) => `vacation[${i}].${field}`,
    ),
  ),
].join(';');

// A line of user-vacations.csv with two vacations; March 4 is a holiday of
// the team's policy.
const line = (email: string) =>
  [
    email,
    '2025-09-01',
    ...['2026-03-02', '2026-03-06', 'annual_leave', 'approved'],
    ...['2026-04-01', '2026-04-01', 'sick_leave', 'pending'],
  ].join(';');

// The import reads the people, the teams' rules and the holidays at once,
// and writes every line in one transaction: hundreds of lines take the
// statements of a few, with the database far away as near.
describe('user-vacations.csv of many people', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let team: Tables<'teams'>;
  let people: Tables<'users'>[];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
    manager = await workspace.addUser({ role: UserRole.Manager });
    const policy = await workspace.addVacationPolicy();
    team = await workspace.addTeam({
      vacation_policy_id: policy.id,
      manager_approvers: [manager.slack_id],
    });
    await t.db
      .insertInto('holidays')
      .values({
        slack_team_id: workspace.id,
        vacation_policy_id: policy.id,
        name: 'Holiday',
        date: '2026-03-04',
        year: 2026,
        created_by: admin.id,
      })
      .execute();
    people = await t.db
      .insertInto('users')
      .values(
        Array.from({ length: PEOPLE }, (_, index) => ({
          slack_team_id: workspace.id,
          slack_id: slackId('U'),
          name: `Person ${index}`,
          email: `person-${index}@example.test`,
          role: UserRole.Member,
          // Half in the team, half in none (the company rules, no policy).
          team_id: index % 2 ? team.id : null,
        })),
      )
      .returningAll()
      .execute();
  });

  // Shares the file and returns the reply to the admin, and how many
  // statements the import sent.
  const importCsv = async (lines: string[]) => {
    const since = t.slackApi.mark();
    const sqlSince = t.sql.mark();

    await t.slack
      .event(workspace, {
        type: 'file_shared',
        file_id: t.slackApi.addFile(
          'user-vacations.csv',
          [HEADER, ...lines].join('\n'),
        ),
        user_id: admin.slack_id,
        channel_id: 'D_TEST',
      })
      .expect(acknowledged);
    await t.idle();

    const [reply] = t.slackApi.ephemeralMessages(
      workspace.token,
      admin.slack_id,
      { since },
    );

    return {
      reply: sectionTexts(reply as unknown as View).join('\n'),
      statements: t.sql.count(sqlSince).all.statements,
    };
  };

  it('imports hundreds of lines with the statements of a few', async () => {
    const few = await importCsv(
      people.slice(0, 3).map(({ email }) => line(email)),
    );
    const many = await importCsv(people.map(({ email }) => line(email)));

    expect(few.reply).toBe(
      '✅ Imported `user-vacations.csv`: Created 6 · Updated 3 · Skipped 0',
    );
    expect(many.reply).toBe(
      `✅ Imported \`user-vacations.csv\`: Created ${2 * PEOPLE} · Updated ${PEOPLE} · Skipped 0`,
    );
    expect(many.statements).toBeLessThanOrEqual(few.statements);
    expect(many.statements).toBeLessThan(30);

    const vacations = await workspace.rows('vacation_requests');
    expect(vacations).toHaveLength(2 * PEOPLE);
    const annualLeave = (user: Tables<'users'>) =>
      vacations.find(
        ({ user_id, type }) => user_id === user.id && type === 'annual_leave',
      )?.working_days;
    expect([annualLeave(people[0]), annualLeave(people[1])]).toEqual([5, 4]);
    expect(
      new Set(
        (await workspace.rows('users'))
          .filter(({ email }) => email.startsWith('person-'))
          .map(({ contract_start_date }) => contract_start_date),
      ),
    ).toEqual(new Set(['2025-09-01']));
  });

  it("closes the approvers' messages of every pending request it replaces, in the same statements", async () => {
    const requesters = people.filter(({ team_id }) => team_id).slice(0, 3);
    for (const requester of requesters) {
      await requestVacation(t, workspace, requester, workWeek(2));
    }
    await t.idle();
    const messages = t.slackApi.postedMessages(
      workspace.token,
      manager.slack_id,
    );
    expect(messages).toHaveLength(3);

    const few = await importCsv(
      people
        .filter(({ team_id }) => !team_id)
        .slice(0, 3)
        .map(({ email }) => line(email)),
    );
    const many = await importCsv(people.map(({ email }) => line(email)));

    expect(many.reply).toBe(
      `✅ Imported \`user-vacations.csv\`: Created ${2 * PEOPLE} · Updated ${PEOPLE} · Skipped 0`,
    );
    // Closing them: a lock, a decision, the comments and the jobs, and a
    // run of each job.
    expect(many.statements).toBeLessThanOrEqual(few.statements + 4 + 3 * 2);
    expect(await workspace.rows('request_workflow_steps')).toEqual([]);
    for (const message of messages) {
      const [update] = t.slackApi.messageUpdates(workspace.token, message);
      expect(textOf(update)).toContain(`Deleted by <@${admin.slack_id}>`);
    }
  });

  it('reports the people it does not know and imports the others', async () => {
    const { reply } = await importCsv([
      ...people.map(({ email }) => line(email)),
      line('ghost@example.test'),
      line(people[0].email),
    ]);

    expect(reply).toBe(
      [
        `⚠️ Imported \`user-vacations.csv\` with problems: Created ${2 * PEOPLE} · Updated ${PEOPLE} · Skipped 2`,
        '*2 problems:*',
        `• ${people[0].email} is in the file more than once: the last line is imported.`,
        '• User not found: ghost@example.test',
      ].join('\n'),
    );
    expect(await workspace.rows('vacation_requests')).toHaveLength(2 * PEOPLE);
  });
});
