import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab } from './support/app-home';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { actionIdsOf, sectionTexts } from './support/tab-readers';
import {
  dmOf,
  shareTeamFile,
  teamFileCsv,
  workspaceState,
} from './support/team-file';
import { ModalView, View } from '@slack/types/dist/views';

describe('Team file', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  it('HR gets the team file in a DM from Teams', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const backend = await workspace.addTeam({
      name: 'Backend',
      manager_approvers: ['ULEAD'],
    });
    const lead = await workspace.addUser({
      slack_id: 'ULEAD',
      name: 'Lee Lead',
      team_id: backend.id,
    });
    const home = await openAppHomeTab(t, workspace, hr, [
      NavigationActionId.Teams,
    ]);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, hr, home, TeamsTabViewActionId.TeamFile)
      .expect(200);
    await t.idle();

    const [file] = t.slackApi.uploadedFiles(workspace.token, dmOf(hr), {
      since,
    });

    expect(file.filename).toBe('team-setup.csv');
    expect(
      file.content.replace('\uFEFF', '').replace(/\r\n$/, '').split('\r\n'),
    ).toEqual([
      'Name,Email,Team,Team lead',
      `Lee Lead,${lead.email},Backend,yes`,
      `Hana HR,${hr.email},,`,
    ]);
  });

  describe('uploading a filled file', () => {
    let hr: Tables<'users'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    });

    const csv = teamFileCsv;
    const share = (user: Tables<'users'>, content: string, fileName?: string) =>
      shareTeamFile(t, workspace, user, content, fileName);
    const uploads = () => workspace.rows('team_file_uploads');
    const state = () => workspaceState(workspace);

    it('gets a preview of teams, leads, moves and unusable rows, and nothing changes', async () => {
      const backend = await workspace.addTeam({
        name: 'Backend',
        manager_approvers: ['ULEAD'],
      });
      const lee = await workspace.addUser({
        slack_id: 'ULEAD',
        name: 'Lee Lead',
        role: UserRole.Manager,
        team_id: backend.id,
      });
      const anna = await workspace.addUser({ name: 'Anna Novak' });
      const bo = await workspace.addUser({ name: 'Bo Brown' });
      const cy = await workspace.addUser({
        name: 'Cy Clark',
        team_id: backend.id,
      });
      const dee = await workspace.addUser({
        name: 'Dee Dunn',
        team_id: backend.id,
      });
      const before = await state();

      const [preview, ...others] = await share(
        hr,
        csv(
          `Anna Novak,${anna.email},Acme,yes`,
          `Bo Brown,${bo.email},Beta,`,
          `Cy Clark,${cy.email},acme,`,
          `Dee Dunn,${dee.email},,`,
          `Lee Lead,${lee.email},Backend,`,
          'Nobody,nobody@example.test,Acme,',
        ),
      );

      expect(others).toEqual([]);
      expect(sectionTexts(preview as unknown as View)).toEqual([
        "*Here's what team-setup.csv will do*",
        [
          '*Teams to create (2)*',
          '• *Acme*: Anna Novak leads, 2 people',
          '• *Beta*: 1 person, no lead, so requests go straight to the second approval',
        ].join('\n'),
        '*Moves between teams (1)*\n• Cy Clark: Backend → Acme',
        '*Lead changes*\n• Lee Lead no longer leads Backend',
        '*Becoming Managers because they lead a team*\n• Anna Novak',
        '*Placed in a team (2)*\n• Anna Novak: Acme\n• Bo Brown: Beta',
        '*Left without a team (1)*\n• Dee Dunn',
        [
          '*Teams with no lead (2)*',
          'Their requests go straight to the second approval.',
          '• Backend',
          '• Beta',
        ].join('\n'),
        '*Team names matched*\n• acme → Acme',
        "⚠️ *Rows it can't use (1)*\n• Row 7: nobody@example.test isn't in this Slack workspace",
        'New teams follow the company rules (no vacation policy; no second approvers yet; nobody notified of decisions).',
      ]);
      expect(actionIdsOf(preview as unknown as View)).toEqual([
        'apply',
        'cancel',
        'rules',
      ]);
      const [upload] = await uploads();
      expect(await uploads()).toHaveLength(1);
      expect(upload).toMatchObject({
        file_name: 'team-setup.csv',
        status: 'previewed',
        uploaded_by: hr.id,
        message_channel: preview.channel,
        message_ts: preview.ts,
      });
      expect(upload.plan_digest).toMatch(/^[0-9a-f]{64}$/);
      expect(await state()).toEqual(before);
    });

    it('shows Slack markup in a team name, a person name and the file name escaped', async () => {
      const eve = await workspace.addUser({ name: 'Eve <!here> & Co' });

      const [preview] = await share(
        hr,
        csv(`Eve,${eve.email},<!channel> & Co,yes`),
        'team <setup> & co.csv',
      );

      expect(sectionTexts(preview as unknown as View).slice(0, 3)).toEqual([
        "*Here's what team &lt;setup&gt; &amp; co.csv will do*",
        [
          '*Teams to create (1)*',
          '• *&lt;!channel&gt; &amp; Co*: Eve &lt;!here&gt; &amp; Co leads, 1 person',
        ].join('\n'),
        '*Becoming Managers because they lead a team*\n• Eve &lt;!here&gt; &amp; Co',
      ]);
      expect(preview.text).toBe(
        "Here's what team &lt;setup&gt; &amp; co.csv will do",
      );
    });

    it('shows markup in unusable reasons and in matched team spellings escaped', async () => {
      const backend = await workspace.addTeam({ name: 'Back <end>' });
      const ann = await workspace.addUser({ name: 'Ann', team_id: null });

      const [preview] = await share(
        hr,
        csv(
          `Ann,${ann.email},back  <END>,`,
          '<!channel>,x<!channel>@example.test,Back <end>,',
        ),
      );

      expect(backend.name).toBe('Back <end>');
      expect(sectionTexts(preview as unknown as View).slice(1)).toEqual([
        '*Placed in a team (1)*\n• Ann: Back &lt;end&gt;',
        [
          '*Teams with no lead (1)*',
          'Their requests go straight to the second approval.',
          '• Back &lt;end&gt;',
        ].join('\n'),
        '*Team names matched*\n• back  &lt;END&gt; → Back &lt;end&gt;',
        "⚠️ *Rows it can't use (1)*\n• Row 3: x&lt;!channel&gt;@example.test isn't in this Slack workspace",
        'New teams follow the company rules (no vacation policy; no second approvers yet; nobody notified of decisions).',
      ]);
    });

    it('lists three leads as "A, B and C lead" and the company rules in one line', async () => {
      const [a, b, c] = await Promise.all(
        ['Ann', 'Bo', 'Cy'].map((name) => workspace.addUser({ name })),
      );
      await t.app.get(CompanyRulesService).update(
        workspace.id,
        {
          hrApprovers: [hr.slack_id],
          hrApproversRule: ApprovalRule.All,
          notificationRecipients: [c.slack_id],
          vacationPolicyId: null,
        },
        hr as unknown as IUserViewModel,
      );

      const [preview] = await share(
        hr,
        csv(
          `Ann,${a.email},Acme,yes`,
          `Bo,${b.email},Acme,yes`,
          `Cy,${c.email},Acme,yes`,
        ),
      );
      const texts = sectionTexts(preview as unknown as View);

      expect(texts[1]).toBe(
        '*Teams to create (1)*\n• *Acme*: Ann, Bo and Cy lead, 3 people',
      );
      expect(texts[texts.length - 1]).toBe(
        `New teams follow the company rules (no vacation policy; second approval by <@${hr.slack_id}> (all of them); <@${c.slack_id}> notified of decisions).`,
      );
    });

    it('a newer file replaces the open preview', async () => {
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      await share(hr, csv(`Anna,${anna.email},Acme,`));
      await share(hr, csv(`Anna,${anna.email},Beta,`));

      expect((await uploads()).map(({ status }) => status).sort()).toEqual([
        'previewed',
        'superseded',
      ]);
    });

    it('Cancel says nothing changed', async () => {
      const anna = await workspace.addUser({ name: 'Anna Novak' });
      const [preview] = await share(hr, csv(`Anna,${anna.email},Acme,`));
      const before = await state();

      await t.slack.actOnMessage(workspace, hr, preview, 'cancel').expect(200);
      await t.idle();

      const [update] = t.slackApi.messageUpdates(workspace.token, preview);
      expect(sectionTexts(update as unknown as View)).toEqual([
        'Canceled. Nothing changed.',
      ]);
      expect(actionIdsOf(update)).toEqual([]);
      expect((await uploads()).map(({ status }) => status)).toEqual([
        'canceled',
      ]);
      expect(await state()).toEqual(before);
    });

    it.each(['apply', 'cancel'])(
      "%s on another workspace's preview changes nothing",
      async (action) => {
        const anna = await workspace.addUser({ name: 'Anna Novak' });
        const [preview] = await share(hr, csv(`Anna,${anna.email},Acme,`));
        const before = await state();
        const other = await t.createWorkspace();
        const otherHr = await other.addUser({ role: UserRole.HR });
        const since = t.slackApi.mark();

        await t.slack.actOnMessage(other, otherHr, preview, action).expect(200);
        await t.idle();

        expect((await uploads()).map(({ status }) => status)).toEqual([
          'previewed',
        ]);
        expect(await state()).toEqual(before);
        expect(await other.rows('teams')).toEqual([]);
        expect(t.slackApi.messageUpdates(workspace.token, preview)).toEqual([]);
        expect(
          t.slackApi
            .ephemeralMessages(other.token, otherHr.slack_id, { since })
            .map(({ text }) => text),
        ).toEqual(['This preview is no longer open. Nothing changed.']);
      },
    );

    it("the preview's Company rules button opens the company rules form", async () => {
      const anna = await workspace.addUser({ name: 'Anna Novak' });
      const [preview] = await share(hr, csv(`Anna,${anna.email},Acme,`));
      const since = t.slackApi.mark();

      await t.slack.actOnMessage(workspace, hr, preview, 'rules').expect(200);
      await t.idle();

      const modal = t.slackApi.openedModal(workspace.token, {
        since,
      }) as ModalView;

      expect(modal.title.text).toBe('Company rules');
    });

    it('says so, with no buttons, when the file changes nothing', async () => {
      const backend = await workspace.addTeam({
        name: 'Backend',
        manager_approvers: ['ULEAD'],
      });
      const lee = await workspace.addUser({
        slack_id: 'ULEAD',
        name: 'Lee Lead',
        role: UserRole.Manager,
        team_id: backend.id,
      });

      const [preview] = await share(
        hr,
        csv(`Lee Lead,${lee.email},Backend,yes`),
      );

      expect(sectionTexts(preview as unknown as View)).toEqual([
        'Nothing to change: the file matches Logbook.',
      ]);
      expect(actionIdsOf(preview as unknown as View)).toEqual([]);
    });

    it('does not say the file matches Logbook when rows were unusable', async () => {
      const [preview] = await share(
        hr,
        csv('Nobody,nobody@example.test,Acme,'),
      );

      expect(sectionTexts(preview as unknown as View)).toEqual([
        'Nothing to change.',
        "⚠️ *Rows it can't use (1)*\n• Row 2: nobody@example.test isn't in this Slack workspace",
      ]);
      expect(actionIdsOf(preview as unknown as View)).toEqual([]);
    });

    it('lets an Admin share a team file and get a preview', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      const [preview] = await share(admin, csv(`Anna,${anna.email},Acme,`));

      expect(sectionTexts(preview as unknown as View)[0]).toBe(
        "*Here's what team-setup.csv will do*",
      );
    });

    it.each([UserRole.Member, UserRole.Manager, UserRole.Finance])(
      'refuses a %s who clicks Apply, Cancel or Company rules',
      async (role) => {
        const anna = await workspace.addUser({ name: 'Anna Novak' });
        const [preview] = await share(hr, csv(`Anna,${anna.email},Acme,`));
        const intruder = await workspace.addUser({ role });
        const before = await state();
        const since = t.slackApi.mark();

        for (const action of ['apply', 'cancel', 'rules']) {
          await t.slack
            .actOnMessage(workspace, intruder, preview, action)
            .expect(200);
        }
        await t.idle();

        expect((await uploads()).map(({ status }) => status)).toEqual([
          'previewed',
        ]);
        expect(await state()).toEqual(before);
        expect(t.slackApi.messageUpdates(workspace.token, preview)).toEqual([]);
        expect(() =>
          t.slackApi.openedModal(workspace.token, { since }),
        ).toThrow('No modal was opened');
      },
    );

    it('refuses a manager who shares a team file and stores nothing', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      const posted = await share(manager, csv(`Anna,${anna.email},Acme,`));

      expect(posted).toEqual([]);
      expect(await uploads()).toEqual([]);
    });
  });
});
