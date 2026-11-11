import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { openAppHomeTab, publishedHome } from './support/app-home';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { acknowledged } from './support/slack-test-client';
import { IPostedMessage } from './support/fake-slack-api.client';
import { actionIdsOf, sectionTexts, titlesOf } from './support/tab-readers';
import { travelTo } from './support/clock';
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

    // Clicks `action` in the message and returns what the app last updated
    // the message to.
    const click = async (
      message: IPostedMessage,
      action: string,
      user = hr,
    ) => {
      await t.slack.actOnMessage(workspace, user, message, action).expect(200);
      await t.idle();

      return t.slackApi.messageUpdates(workspace.token, message).pop() as
        IPostedMessage | undefined;
    };
    const textsOf = (message?: { blocks?: unknown[] }) =>
      sectionTexts(message as unknown as View);
    const teamsByName = async () =>
      Object.fromEntries(
        (await workspace.rows('teams')).map((team) => [team.name, team]),
      );
    const people = async () =>
      (await workspace.rows('users'))
        .map(({ name, team_id, role }) => ({ name, team_id, role }))
        .sort((a, b) => a.name.localeCompare(b.name));

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

    describe('Apply', () => {
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
        expect(actionIdsOf(result!)).toEqual([
          NavigationActionId.Teams,
          'undo',
        ]);
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
        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Acme,yes`),
        );
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
          csv(
            `Anna Novak,${anna.email},Acme,yes`,
            `Bo Brown,${bo.email},Acme,`,
          ),
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
          csv(
            `Anna Novak,${anna.email},Acme,`,
            `Bo Brown,${bo.email},Acme,yes`,
          ),
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

        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Beta,yes`),
        );
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
        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Acme,`),
        );
        const [shown] = await uploads();
        await t.db
          .updateTable('users')
          .set({ team_id: backend.id })
          .where('id', '=', anna.id)
          .execute();
        const before = await state();

        const update = await click(preview, 'apply');

        expect(textsOf(update)).toEqual([
          "Logbook changed since this preview, so here's what the file will do now.",
          '*Teams to create (1)*\n• *Acme*: 1 person, no lead, so requests go straight to the second approval',
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

        const result = await click(
          { ...preview, blocks: update!.blocks },
          'apply',
        );

        expect(textsOf(result)).toEqual([
          '✅ Created 1 team and placed 1 person.',
        ]);
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
        expect(actionIdsOf(update!)).toEqual([]);
        expect(await state()).toEqual(before);
        expect((await uploads()).map(({ status }) => status).sort()).toEqual([
          'previewed',
          'superseded',
        ]);
      });

      it('Apply on a canceled preview changes nothing', async () => {
        const anna = await workspace.addUser({ name: 'Anna Novak' });
        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Acme,`),
        );
        await click(preview, 'cancel');
        const before = await state();

        const update = await click(preview, 'apply');

        expect(textsOf(update)).toEqual(['Canceled. Nothing changed.']);
        expect(await state()).toEqual(before);
        expect((await uploads()).map(({ status }) => status)).toEqual([
          'canceled',
        ]);
      });

      it('a second click on Apply changes nothing and keeps the result', async () => {
        const anna = await workspace.addUser({ name: 'Anna Novak' });
        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Acme,`),
        );
        await click(preview, 'apply');
        const before = await state();

        await click(preview, 'apply');

        expect(await state()).toEqual(before);
        expect(
          t.slackApi.messageUpdates(workspace.token, preview),
        ).toHaveLength(1);
        expect((await uploads()).map(({ status }) => status)).toEqual([
          'applied',
        ]);
      });

      it('Apply more than 7 days after the preview says it expired and changes nothing', async () => {
        const anna = await workspace.addUser({ name: 'Anna Novak' });
        const [preview] = await share(
          hr,
          csv(`Anna Novak,${anna.email},Acme,`),
        );
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
  });
});
