import { randomUUID } from 'crypto';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { IPostedMessage } from './support/fake-slack-api.client';
import { actionIdsOf } from './support/tab-readers';
import { travelTo } from './support/clock';
import {
  clickInMessage,
  messageTexts,
  shareTeamFile,
  teamFileCsv,
} from './support/team-file';

describe('Team file Undo', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
  });

  const csv = teamFileCsv;
  const click = (message: IPostedMessage, action: string) =>
    clickInMessage(t, workspace, hr, message, action);
  const uploads = () => workspace.rows('team_file_uploads');
  const people = async () =>
    (await workspace.rows('users'))
      .map(({ name, team_id, role }) => ({ name, team_id, role }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const teams = async () =>
    (await workspace.rows('teams'))
      .map(({ name, manager_approvers }) => ({ name, manager_approvers }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const moveTo = (user: Tables<'users'>, teamId: string) =>
    t.db
      .updateTable('users')
      .set({ team_id: teamId })
      .where('id', '=', user.id)
      .execute();

  // Shares and applies a file; returns the preview message carrying the
  // result's blocks, which hold the Undo button.
  const apply = async (content: string) => {
    const [preview] = await shareTeamFile(t, workspace, hr, content);
    const result = await click(preview, 'apply');

    return { ...preview, blocks: result!.blocks };
  };
  const told = (since: number) =>
    t.slackApi
      .ephemeralMessages(workspace.token, hr.slack_id, { since })
      .map(({ text }) => text);

  it('Undo restores teams, leads and roles and deletes the teams it created', async () => {
    const dee = await workspace.addUser({
      name: 'Dee Dunn',
      role: UserRole.Manager,
    });
    const backend = await workspace.addTeam({
      name: 'Backend',
      manager_approvers: [dee.slack_id],
    });
    await moveTo(dee, backend.id);
    const dan = await workspace.addUser({
      name: 'Dan Doe',
      team_id: backend.id,
    });
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const peopleBefore = await people();
    const teamsBefore = await teams();
    const applied = await apply(
      csv(
        `Dee Dunn,${dee.email},Backend,`,
        `Dan Doe,${dan.email},Acme,`,
        `Anna Novak,${anna.email},Acme,yes`,
        `Bo Brown,${bo.email},Acme,`,
      ),
    );
    expect(await teams()).toEqual([
      { name: 'Acme', manager_approvers: [anna.slack_id] },
      { name: 'Backend', manager_approvers: [] },
    ]);

    const update = await click(applied, 'undo');

    expect(messageTexts(update)).toEqual(['↩️ Undone: 5 changes restored.']);
    expect(update!.text).toBe('↩️ Undone: 5 changes restored.');
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await people()).toEqual(peopleBefore);
    expect(await teams()).toEqual(teamsBefore);
    const [upload] = await uploads();
    expect(upload).toMatchObject({
      status: 'undone',
      undone_at: expect.any(String),
    });
  });

  it('Undo keeps a team change made by hand after the upload and says so', async () => {
    const backend = await workspace.addTeam({ name: 'Backend' });
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const applied = await apply(
      csv(`Anna Novak,${anna.email},Acme,yes`, `Bo Brown,${bo.email},Acme,`),
    );
    await moveTo(bo, backend.id);

    const update = await click(applied, 'undo');

    expect(messageTexts(update)).toEqual([
      "↩️ Undone: 2 changes restored.\nKept as they are:\n• Bo Brown's team, changed since",
    ]);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: null, role: UserRole.Member },
      { name: 'Bo Brown', team_id: backend.id, role: UserRole.Member },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
    ]);
    expect(await teams()).toEqual([
      { name: 'Backend', manager_approvers: null },
    ]);
  });

  it('Undo keeps a created team that has requests, and a Manager who still leads it', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const applied = await apply(csv(`Anna Novak,${anna.email},Acme,yes`));
    const [acme] = await workspace.rows('teams');
    await workspace.addVacationRequest(
      { ...anna, team_id: acme.id },
      { start_date: '2026-07-01', end_date: '2026-07-01' },
    );

    const update = await click(applied, 'undo');

    expect(messageTexts(update)).toEqual([
      [
        '↩️ Undone: 1 change restored.',
        'Kept as they are:',
        '• Acme kept: it has requests or time',
        '• Anna Novak stays a Manager: still leads Acme',
      ].join('\n'),
    ]);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: null, role: UserRole.Manager },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
    ]);
    expect(await teams()).toEqual([
      { name: 'Acme', manager_approvers: [anna.slack_id] },
    ]);
  });

  it('Undo is refused after a newer upload was applied', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const first = await apply(csv(`Anna Novak,${anna.email},Acme,`));
    await apply(csv(`Bo Brown,${bo.email},Beta,`));
    const before = await people();
    const since = t.slackApi.mark();

    const update = await click(first, 'undo');

    expect(told(since)).toEqual([
      'Undo is no longer available: a newer file was applied.',
    ]);
    expect(actionIdsOf(update!)).toEqual(['nav_teams', 'undo']);
    expect(await people()).toEqual(before);
    expect((await uploads()).map(({ status }) => status)).toEqual([
      'applied',
      'applied',
    ]);
  });

  it('Undo of the newer file makes the one before it undoable', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const first = await apply(csv(`Anna Novak,${anna.email},Acme,`));
    const second = await apply(csv(`Bo Brown,${bo.email},Beta,`));

    await click(second, 'undo');
    const update = await click(first, 'undo');

    expect(messageTexts(update)).toEqual(['↩️ Undone: 1 change restored.']);
    expect(await teams()).toEqual([]);
    expect((await uploads()).map(({ status }) => status).sort()).toEqual([
      'undone',
      'undone',
    ]);
  });

  it('Undo is refused after 7 days', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const applied = await apply(csv(`Anna Novak,${anna.email},Acme,`));
    const before = await people();
    travelTo('2026-06-25');
    const since = t.slackApi.mark();

    await click(applied, 'undo');

    expect(told(since)).toEqual([
      "Undo is no longer available: it's been more than 7 days.",
    ]);
    expect(await people()).toEqual(before);
    expect((await uploads())[0].status).toBe('applied');
  });

  it('a second Undo says it was already undone, and two at once undo once', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const applied = await apply(csv(`Anna Novak,${anna.email},Acme,`));

    await Promise.all(
      [1, 2].map(() =>
        t.slack.actOnMessage(workspace, hr, applied, 'undo').expect(200),
      ),
    );
    await t.idle();
    const since = t.slackApi.mark();
    await click(applied, 'undo');

    expect(told(since)).toEqual([
      'Undo is no longer available: it was already undone.',
    ]);
    expect(
      t.slackApi
        .messageUpdates(workspace.token, applied)
        .map((update) => messageTexts(update)[0]),
    ).toEqual([
      '✅ Created 1 team and placed 1 person.',
      '↩️ Undone: 1 change restored.',
    ]);
  });

  it('a forged Undo with an ID that is no upload of the workspace changes nothing', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const applied = await apply(csv(`Anna Novak,${anna.email},Acme,`));
    const before = await people();
    const since = t.slackApi.mark();
    const forged = (value: string) => ({
      ...applied,
      blocks: [
        {
          type: 'actions',
          block_id: ViewCallbackId.TeamFileMessage,
          elements: [
            {
              type: 'button',
              action_id: 'undo',
              text: { type: 'plain_text', text: 'Undo' },
              value,
            },
          ],
        },
      ],
    });

    await click(forged(`undo:${randomUUID()}`), 'undo');
    await click(forged('undo:not-an-id'), 'undo');
    await click(forged('undo'), 'undo');

    expect(told(since)).toEqual(
      Array(3).fill('This preview is no longer open. Nothing changed.'),
    );
    expect(await people()).toEqual(before);
    expect((await uploads())[0].status).toBe('applied');
  });
});
