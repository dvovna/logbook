import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ApproverRemindersService } from '@modules/slack/approvals/services/approver-reminders.service';
import { PendingApprovalsService } from '@modules/slack/common/services/pending-approvals.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { requestVacation } from './support/vacation-flows';

// Today is Wednesday 2026-06-17, 09:00 UTC: the week's reminder (Monday
// 09:00 on) and the day's are both due.
const THREE_DAYS_AGO = '2026-06-14T09:00:00.000Z';

describe('Approver reminders', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;
  let project: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin, name: 'Ann' });
    manager = await workspace.addUser({ role: UserRole.Manager, name: 'Max' });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Mia' });
    project = await workspace.addProject({ name: 'Website' });
    await workspace.assignToProject(project, { teams: [team] });
  });

  const reminders = () => t.app.get(ApproverRemindersService);

  const remindedTexts = async (user: Tables<'users'>, since: number) => {
    await t.idle();
    await t.retryJobs();

    return t.slackApi
      .postedMessages(workspace.token, user.slack_id, { since })
      .map(({ text }) => text);
  };

  // A time off request whose step has waited for its manager since
  // `askedAt`.
  const waitingRequest = async (askedAt: string) => {
    const request = await requestVacation(t, workspace, member, {
      start: '2026-07-06',
      end: '2026-07-07',
    });
    await t.idle();
    await t.db
      .updateTable('request_workflow_steps')
      .set({ processed_at: askedAt })
      .where('request_id', '=', request.id)
      .execute();

    return request;
  };

  const submittedEntry = (owner: Tables<'users'>, submittedAt: string) =>
    workspace.addTimeEntry(owner, project, {
      status: TimeEntryStatus.Submitted,
      updated_at: submittedAt,
    });

  it('sends each approver one DM of the time off and time entries that waited two days, once a week', async () => {
    await waitingRequest(THREE_DAYS_AGO);
    await submittedEntry(member, THREE_DAYS_AGO);
    await submittedEntry(member, '2026-06-13T12:00:00.000Z');
    // Submitted yesterday: its manager got its DM, and it is no reason yet.
    await submittedEntry(member, '2026-06-16T09:00:00.000Z');
    const since = t.slackApi.mark();

    expect(await reminders().remindAll(new Date())).toBe(1);

    expect(await remindedTexts(manager, since)).toEqual([
      [
        ':hourglass_flowing_sand: Still waiting for your decision:',
        '• 1 time off request, the oldest since 14 Jun 2026',
        '• 2 time entries of 1 person, the oldest since 13 Jun 2026',
        "Decide them under ✅ Approvals on Logbook's Home.",
        'Change how often you are reminded: Home → 🔔 Reminders.',
      ].join('\n'),
    ]);
    // What the reminder counts is a part of what the Approvals count shows.
    expect(
      await t.app
        .get(PendingApprovalsService)
        .count(manager as unknown as IUserViewModel),
    ).toEqual({
      timeOff: 1,
      timeEntries: 3,
    });
    expect(await remindedTexts(admin, since)).toEqual([]);

    // A restart, a second process or the next tick sends nothing more.
    expect(await reminders().remindAll(new Date())).toBe(0);
    expect(await remindedTexts(manager, since)).toHaveLength(1);
  });

  it('reminds whom the entries of someone in no team wait for: the admins when nobody has the HR role', async () => {
    const loner = await workspace.addUser({ name: 'Lou' });
    await submittedEntry(loner, THREE_DAYS_AGO);
    const since = t.slackApi.mark();

    expect(await reminders().remindAll(new Date())).toBe(1);

    expect(await remindedTexts(admin, since)).toEqual([
      expect.stringContaining('• 1 time entry of 1 person'),
    ]);
    expect(await remindedTexts(manager, since)).toEqual([]);
  });

  it("follows each approver's 🔔 Reminders choice", async () => {
    await submittedEntry(member, THREE_DAYS_AGO);
    await t.db
      .updateTable('users')
      .set({ time_reminder: TimeReminder.Off })
      .where('id', '=', manager.id)
      .execute();
    const since = t.slackApi.mark();

    expect(await reminders().remindAll(new Date())).toBe(0);

    await t.db
      .updateTable('users')
      .set({ time_reminder: TimeReminder.Daily })
      .where('id', '=', manager.id)
      .execute();

    // The week was claimed already; the day goes to the daily ones.
    expect(await reminders().remindAll(new Date())).toBe(0);
    await t.db
      .updateTable('slack_teams')
      .set({ approver_reminder_day: null })
      .where('id', '=', workspace.id)
      .execute();
    expect(await reminders().remindAll(new Date())).toBe(1);
    expect(await remindedTexts(manager, since)).toHaveLength(1);
  });
});
