import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab } from './support/app-home';
import { acknowledged } from './support/slack-test-client';
import { actionIdsOf, sectionTexts } from './support/tab-readers';
import { ModalView, View } from '@slack/types/dist/views';

// The DM channel of a user, as Slack answers a message to their user ID.
const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

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

    const csv = (...lines: string[]) =>
      ['Name,Email,Team,Team lead', ...lines].join('\n');

    // Shares the file in the DM with the app and returns what the app posted
    // back to the sharer.
    const share = async (
      user: Tables<'users'>,
      content: string,
      fileName = 'team-setup.csv',
    ) => {
      const since = t.slackApi.mark();

      await t.slack
        .event(workspace, {
          type: 'file_shared',
          file_id: t.slackApi.addFile(fileName, content),
          user_id: user.slack_id,
          channel_id: dmOf(user),
        })
        .expect(acknowledged);
      await t.idle();

      return t.slackApi.postedMessages(workspace.token, user.slack_id, {
        since,
      });
    };

    const uploads = () => workspace.rows('team_file_uploads');
    const state = async () => ({
      teams: await workspace.rows('teams'),
      users: await workspace.rows('users'),
    });

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
          '• *Acme* : Anna Novak leads, 2 people',
          '• *Beta* : no lead, so requests go straight to the second approval, 1 person',
        ].join('\n'),
        [
          '*People changing team (4)*',
          '• Anna Novak: no team → Acme',
          '• Bo Brown: no team → Beta',
          '• Cy Clark: Backend → Acme',
          '• Dee Dunn: Backend → no team',
        ].join('\n'),
        '*Lead changes*\n• Lee Lead no longer leads Backend',
        '*Becoming Managers because they lead a team*\n• Anna Novak',
        '*Left without a team (1)*\n• Dee Dunn',
        [
          '*Teams with no lead (2)*',
          'Their requests go straight to the second approval.',
          '• Backend',
          '• Beta',
        ].join('\n'),
        '*Team names matched*\n• acme → Acme',
        "*Rows it can't use (1)*\n• Row 7: nobody@example.test isn't in this Slack workspace",
        'New teams follow the company rules (no vacation policy; no second approvers yet).',
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
          '• *&lt;!channel&gt; &amp; Co* : Eve &lt;!here&gt; &amp; Co leads, 1 person',
        ].join('\n'),
        '*People changing team (1)*\n• Eve &lt;!here&gt; &amp; Co: no team → &lt;!channel&gt; &amp; Co',
      ]);
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

    it("Cancel on another workspace's preview changes nothing", async () => {
      const anna = await workspace.addUser({ name: 'Anna Novak' });
      const [preview] = await share(hr, csv(`Anna,${anna.email},Acme,`));
      const other = await t.createWorkspace();
      const otherHr = await other.addUser({ role: UserRole.HR });
      const since = t.slackApi.mark();

      await t.slack.actOnMessage(other, otherHr, preview, 'cancel').expect(200);
      await t.idle();

      expect((await uploads()).map(({ status }) => status)).toEqual([
        'previewed',
      ]);
      expect(t.slackApi.messageUpdates(workspace.token, preview)).toEqual([]);
      expect(
        t.slackApi
          .ephemeralMessages(other.token, otherHr.slack_id, { since })
          .map(({ text }) => text),
      ).toEqual(['This preview is no longer open. Nothing changed.']);
    });

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

    it('refuses a manager who shares a team file and stores nothing', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const anna = await workspace.addUser({ name: 'Anna Novak' });

      const posted = await share(manager, csv(`Anna,${anna.email},Acme,`));

      expect(posted).toEqual([]);
      expect(await uploads()).toEqual([]);
    });
  });
});
