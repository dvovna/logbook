import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { publishedHome } from './support/app-home';
import { IPostedMessage } from './support/fake-slack-api.client';
import { actionIdsOf, titlesOf } from './support/tab-readers';
import { travelTo } from './support/clock';
import {
  clickInMessage,
  messageTexts,
  shareTeamFile,
  teamFileCsv,
  workspaceState,
} from './support/team-file';

const CHANGED_SINCE_PREVIEW =
  "Logbook changed since this preview, so here's what the file will do now.";

describe('Team file Apply', () => {
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
  const share = (user: Tables<'users'>, content: string) =>
    shareTeamFile(t, workspace, user, content);
  const click = (message: IPostedMessage, action: string, user = hr) =>
    clickInMessage(t, workspace, user, message, action);
  // Two clicks at once, as a double click sends them.
  const doubleClick = async (message: IPostedMessage) => {
    await Promise.all(
      [1, 2].map(() =>
        t.slack.actOnMessage(workspace, hr, message, 'apply').expect(200),
      ),
    );
    await t.idle();
  };
  const textsOf = messageTexts;
  const uploads = () => workspace.rows('team_file_uploads');
  const state = () => workspaceState(workspace);
  const moveTo = (user: Tables<'users'>, teamId: string) =>
    t.db
      .updateTable('users')
      .set({ team_id: teamId })
      .where('id', '=', user.id)
      .execute();
  const teamsByName = async () =>
    Object.fromEntries(
      (await workspace.rows('teams')).map((team) => [team.name, team]),
    );
  const people = async () =>
    (await workspace.rows('users'))
      .map(({ name, team_id, role }) => ({ name, team_id, role }))
      .sort((a, b) => a.name.localeCompare(b.name));

  it('Apply creates the teams following company rules, places people, sets leads and makes a member lead a Manager', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const cy = await workspace.addUser({
      name: 'Cy Clark',
      role: UserRole.Manager,
    });
    const maria = await workspace.addUser({ name: 'Maria Volkova' });
    const [preview] = await share(
      hr,
      csv(
        `Anna Novak,${anna.email},Acme,yes`,
        `Bo Brown,${bo.email},Acme,`,
        `Cy Clark,${cy.email},Beta,yes`,
        `Maria Volkova,${maria.email},,`,
      ),
    );

    const result = await click(preview, 'apply');

    const [companyRules] = await workspace.rows('rule_sets');
    const { Acme: acme, Beta: beta } = await teamsByName();
    expect(
      [acme, beta].map(
        ({ rule_set_id, manager_approvers, manager_approvers_rule }) => ({
          rule_set_id,
          manager_approvers,
          manager_approvers_rule,
        }),
      ),
    ).toEqual([
      {
        rule_set_id: companyRules.id,
        manager_approvers: [anna.slack_id],
        manager_approvers_rule: ApprovalRule.Any,
      },
      {
        rule_set_id: companyRules.id,
        manager_approvers: [cy.slack_id],
        manager_approvers_rule: ApprovalRule.Any,
      },
    ]);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: acme.id, role: UserRole.Manager },
      { name: 'Bo Brown', team_id: acme.id, role: UserRole.Member },
      { name: 'Cy Clark', team_id: beta.id, role: UserRole.Manager },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
      { name: 'Maria Volkova', team_id: null, role: UserRole.Member },
    ]);
    expect(textsOf(result)).toEqual([
      '✅ Created 2 teams, placed 3 people and made 1 person a Manager. Maria Volkova has no team yet.',
    ]);
    expect(result!.text).toBe(
      '✅ Created 2 teams, placed 3 people and made 1 person a Manager. Maria Volkova has no team yet.',
    );
    expect(actionIdsOf(result!)).toEqual([NavigationActionId.Teams, 'undo']);
    const [upload] = await uploads();
    expect(upload).toMatchObject({
      status: 'applied',
      applied_at: expect.any(String),
    });
    expect(upload.undo).toEqual({
      createdTeamIds: [acme.id, beta.id],
      assignments: [
        { userId: anna.id, before: null, after: acme.id },
        { userId: bo.id, before: null, after: acme.id },
        { userId: cy.id, before: null, after: beta.id },
      ],
      approvers: [],
      promotions: [{ userId: anna.id, before: UserRole.Member }],
    });
  });

  it("the result's Open Teams shows the Teams screen", async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,yes`));
    const result = await click(preview, 'apply');
    const since = t.slackApi.mark();

    await t.slack
      .actOnMessage(
        workspace,
        hr,
        { ...preview, blocks: result!.blocks },
        NavigationActionId.Teams,
      )
      .expect(200);

    expect(titlesOf(await publishedHome(t, workspace, hr, since))).toEqual([
      'Acme',
    ]);
  });

  it('uploading again with an empty Team takes a person out, a removed yes removes the lead, and teams not in the file stay', async () => {
    const other = await workspace.addTeam({
      name: 'Other',
      manager_approvers: ['UOTHERLEAD'],
    });
    await workspace.addUser({ name: 'Zed Zane', team_id: other.id });
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const bo = await workspace.addUser({ name: 'Bo Brown' });
    const [first] = await share(
      hr,
      csv(`Anna Novak,${anna.email},Acme,yes`, `Bo Brown,${bo.email},Acme,`),
    );
    await click(first, 'apply');
    const { Acme: acme } = await teamsByName();

    const [second] = await share(
      hr,
      csv(`Anna Novak,${anna.email},Acme,`, `Bo Brown,${bo.email},,`),
    );
    const result = await click(second, 'apply');

    const teams = await teamsByName();
    expect(Object.keys(teams).sort()).toEqual(['Acme', 'Other']);
    expect(teams.Acme.manager_approvers).toEqual([]);
    expect(teams.Other).toEqual(other);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: acme.id, role: UserRole.Manager },
      { name: 'Bo Brown', team_id: null, role: UserRole.Member },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
      { name: 'Zed Zane', team_id: other.id, role: UserRole.Member },
    ]);
    expect(textsOf(result)).toEqual([
      '✅ Took 1 person out of a team and removed 1 lead. Bo Brown has no team yet.',
    ]);
    const upload = (await uploads()).find(
      ({ message_ts }) => message_ts === second.ts,
    );
    expect(upload?.undo).toEqual({
      createdTeamIds: [],
      assignments: [{ userId: bo.id, before: acme.id, after: null }],
      approvers: [{ teamId: acme.id, before: [anna.slack_id], after: [] }],
      promotions: [],
    });
  });

  it('a non-member manager approver stays after a re-upload', async () => {
    const lee = await workspace.addUser({
      name: 'Lee Lead',
      role: UserRole.Manager,
    });
    const annaSlackId = slackId('U');
    const acme = await workspace.addTeam({
      name: 'Acme',
      manager_approvers: [lee.slack_id, annaSlackId],
    });
    const anna = await workspace.addUser({
      slack_id: annaSlackId,
      name: 'Anna Novak',
      role: UserRole.Manager,
      team_id: acme.id,
    });
    const bo = await workspace.addUser({
      name: 'Bo Brown',
      team_id: acme.id,
    });

    const [preview] = await share(
      hr,
      csv(`Anna Novak,${anna.email},Acme,`, `Bo Brown,${bo.email},Acme,yes`),
    );
    const result = await click(preview, 'apply');

    expect((await teamsByName()).Acme.manager_approvers).toEqual([
      lee.slack_id,
      bo.slack_id,
    ]);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: acme.id, role: UserRole.Manager },
      { name: 'Bo Brown', team_id: acme.id, role: UserRole.Manager },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
      { name: 'Lee Lead', team_id: null, role: UserRole.Manager },
    ]);
    expect(textsOf(result)).toEqual([
      '✅ Added 1 lead, removed 1 lead and made 1 person a Manager.',
    ]);
  });

  it('a lead the file moves to another team stops leading the old one', async () => {
    const annaSlackId = slackId('U');
    const acme = await workspace.addTeam({
      name: 'Acme',
      manager_approvers: [annaSlackId],
    });
    const beta = await workspace.addTeam({ name: 'Beta' });
    const anna = await workspace.addUser({
      slack_id: annaSlackId,
      name: 'Anna Novak',
      role: UserRole.Manager,
      team_id: acme.id,
    });

    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Beta,yes`));
    const result = await click(preview, 'apply');

    const teams = await teamsByName();
    expect([
      teams.Acme.manager_approvers,
      teams.Beta.manager_approvers,
    ]).toEqual([[], [annaSlackId]]);
    expect((await people())[0]).toEqual({
      name: 'Anna Novak',
      team_id: beta.id,
      role: UserRole.Manager,
    });
    expect(textsOf(result)).toEqual([
      '✅ Placed 1 person, added 1 lead and removed 1 lead.',
    ]);
  });

  it('a change made between preview and Apply gets a new preview instead', async () => {
    const backend = await workspace.addTeam({ name: 'Backend' });
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    const [shown] = await uploads();
    await moveTo(anna, backend.id);
    const before = await state();

    const update = await click(preview, 'apply');

    expect(textsOf(update)).toEqual([
      CHANGED_SINCE_PREVIEW,
      '*Teams to create (1)*\n• *Acme*: 1 person, no lead, so requests go to HR or an admin',
      '*Moves between teams (1)*\n• Anna Novak: Backend → Acme',
      [
        '*Teams with no lead (2)*',
        'Their requests go straight to the second approval.',
        '• Backend',
        '• Acme',
      ].join('\n'),
      'New teams follow the company rules (no vacation policy; no second approvers yet; nobody notified of decisions).',
    ]);
    expect(actionIdsOf(update!)).toEqual(['apply', 'cancel', 'rules']);
    expect(await state()).toEqual(before);
    const [upload] = await uploads();
    expect(upload.status).toBe('previewed');
    expect(upload.plan_digest).not.toBe(shown.plan_digest);

    const result = await click({ ...preview, blocks: update!.blocks }, 'apply');

    expect(textsOf(result)).toEqual(['✅ Created 1 team and placed 1 person.']);
    expect((await people())[0]).toEqual({
      name: 'Anna Novak',
      team_id: (await teamsByName()).Acme.id,
      role: UserRole.Member,
    });
  });

  it('Apply on a preview replaced by a newer file changes nothing', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [older] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    await share(hr, csv(`Anna Novak,${anna.email},Beta,`));
    const before = await state();

    const update = await click(older, 'apply');

    expect(textsOf(update)).toEqual([
      'A newer file replaced this one. Nothing changed.',
    ]);
    expect(update!.text).toBe(
      'A newer file replaced this one. Nothing changed.',
    );
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await state()).toEqual(before);
    expect((await uploads()).map(({ status }) => status).sort()).toEqual([
      'previewed',
      'superseded',
    ]);
  });

  it('Apply on a canceled preview changes nothing', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    await click(preview, 'cancel');
    const before = await state();

    const update = await click(preview, 'apply');

    expect(textsOf(update)).toEqual(['Canceled. Nothing changed.']);
    expect(await state()).toEqual(before);
    expect((await uploads()).map(({ status }) => status)).toEqual(['canceled']);
  });

  it('a double click on Apply applies once and keeps the result', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));

    await doubleClick(preview);

    const [update, ...others] = t.slackApi.messageUpdates(
      workspace.token,
      preview,
    );
    expect(others).toEqual([]);
    expect(textsOf(update)).toEqual(['✅ Created 1 team and placed 1 person.']);
    expect(Object.keys(await teamsByName())).toEqual(['Acme']);
    expect((await uploads()).map(({ status }) => status)).toEqual(['applied']);
  });

  it("a double click on Apply of a preview Logbook changed since applies nothing, and the new preview's Apply does", async () => {
    const backend = await workspace.addTeam({ name: 'Backend' });
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    await moveTo(anna, backend.id);
    const before = await state();

    await doubleClick(preview);

    const updates = t.slackApi.messageUpdates(workspace.token, preview);
    expect(updates.map((update) => textsOf(update)[0])).toEqual([
      CHANGED_SINCE_PREVIEW,
      CHANGED_SINCE_PREVIEW,
    ]);
    expect(await state()).toEqual(before);
    expect((await uploads()).map(({ status }) => status)).toEqual([
      'previewed',
    ]);

    const result = await click(
      { ...preview, blocks: updates[1].blocks as IPostedMessage['blocks'] },
      'apply',
    );

    expect(textsOf(result)).toEqual(['✅ Created 1 team and placed 1 person.']);
  });

  it('a forged Apply on a file that changes nothing marks nothing applied', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},,`));
    const [upload] = await uploads();
    const forged = {
      ...preview,
      blocks: [
        {
          type: 'actions',
          block_id: ViewCallbackId.TeamFileMessage,
          elements: [
            {
              type: 'button',
              action_id: 'apply',
              text: { type: 'plain_text', text: 'Apply' },
              value: `apply:${upload.id}:${upload.plan_digest}`,
            },
          ],
        },
      ],
    };

    const update = await click(forged, 'apply');

    expect(textsOf(update)).toEqual([
      'Nothing to change: the file matches Logbook.',
    ]);
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await uploads()).toEqual([upload]);
  });

  it('Apply after the same changes were made by hand marks nothing applied', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    const acme = await workspace.addTeam({ name: 'Acme' });
    await moveTo(anna, acme.id);

    const update = await click(preview, 'apply');

    expect(textsOf(update)).toEqual([
      CHANGED_SINCE_PREVIEW,
      'Nothing to change: the file matches Logbook.',
    ]);
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await uploads()).toMatchObject([
      { status: 'previewed', applied_at: null, undo: null },
    ]);
  });

  it("tells HR it was applied when the result can't be shown", async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    const since = t.slackApi.mark();
    t.slackApi.failNext('chat.update');

    await click(preview, 'apply');

    expect((await uploads()).map(({ status }) => status)).toEqual(['applied']);
    const told = t.slackApi.ephemeralMessages(workspace.token, hr.slack_id, {
      since,
    });
    expect(told.map(({ text }) => text)).toEqual([
      "Applied, but the message couldn't be updated. Open Teams to check.",
    ]);
    expect(textsOf(told[0])).toEqual([
      '✅ Created 1 team and placed 1 person.',
    ]);
    expect(actionIdsOf(told[0])).toEqual([NavigationActionId.Teams, 'undo']);
  });

  it('Apply more than 7 days after the preview says it expired and changes nothing', async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const [preview] = await share(hr, csv(`Anna Novak,${anna.email},Acme,`));
    const before = await state();
    travelTo('2026-06-25');

    const update = await click(preview, 'apply');

    expect(textsOf(update)).toEqual([
      'This preview has expired. Send the file again.',
    ]);
    expect(actionIdsOf(update!)).toEqual([]);
    expect(await state()).toEqual(before);
    expect((await uploads()).map(({ status }) => status)).toEqual([
      'previewed',
    ]);
  });

  it("rows that can't be used don't stop the rest", async () => {
    const anna = await workspace.addUser({ name: 'Anna Novak' });
    const hal = await workspace.addUser({
      name: 'Hal Hughes',
      role: UserRole.HR,
    });
    const [preview] = await share(
      hr,
      csv(
        `Anna Novak,${anna.email},Acme,yes`,
        `Hal Hughes,${hal.email},Acme,yes`,
        'Nobody,nobody@example.test,Acme,',
      ),
    );

    const result = await click(preview, 'apply');

    const { Acme: acme } = await teamsByName();
    expect(acme.manager_approvers).toEqual([anna.slack_id]);
    expect(await people()).toEqual([
      { name: 'Anna Novak', team_id: acme.id, role: UserRole.Manager },
      { name: 'Hal Hughes', team_id: null, role: UserRole.HR },
      { name: 'Hana HR', team_id: null, role: UserRole.HR },
    ]);
    expect(textsOf(result)).toEqual([
      '✅ Created 1 team, placed 1 person and made 1 person a Manager.',
      [
        "⚠️ *Rows it didn't use (2)*",
        "• Row 3: Hal Hughes has the HR role, which can't approve at level 1",
        "• Row 4: nobody@example.test isn't in this Slack workspace",
      ].join('\n'),
    ]);
  });
});
