import { View } from '@slack/types/dist/views';
import request from 'supertest';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { WELCOME_TEXT } from '@modules/team-setup/team-setup-workflow.service';
import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { IPostedMessage } from './support/fake-slack-api.client';
import { sectionTexts } from './support/tab-readers';
import { dmOf } from './support/team-file';
import { openAppHomeTab, openModalFrom } from './support/app-home';

const ADA = 'Ada Lovelace';
const QUESTION = `👋 *${ADA}* joined Slack. Which team is ${ADA} on?`;

describe('New people', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let hr2: Tables<'users'>;
  let acme: Tables<'teams'>;
  let beta: Tables<'teams'>;
  const installed: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    // Not TestWorkspaces: the app created these rows itself.
    if (installed.length) {
      await t.db
        .deleteFrom('slack_teams')
        .where('slack_id', 'in', installed)
        .execute();
    }
    await t.close();
  });

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    hr2 = await workspace.addUser({ role: UserRole.HR, name: 'Hugo HR' });
    // Created in the opposite order: the choices are sorted by name.
    beta = await workspace.addTeam({ name: 'Beta' });
    acme = await workspace.addTeam({ name: 'Acme' });
  });

  const markImported = () =>
    t.db
      .updateTable('slack_teams')
      .set({ members_imported_at: new Date().toISOString() })
      .where('id', '=', workspace.id)
      .execute();

  const join = async () => {
    const id = slackId('U');

    await t.slack
      .event(workspace, {
        type: 'team_join',
        user: {
          id,
          team_id: workspace.slackId,
          name: 'ada',
          real_name: ADA,
          profile: { email: `${id.toLowerCase()}@example.test` },
          is_admin: false,
          is_owner: false,
          is_bot: false,
          deleted: false,
        },
      })
      .expect(acknowledged);
    await t.idle();

    return (await workspace.rows('users')).find(
      ({ slack_id }) => slack_id === id,
    )!;
  };

  // Slack's members.list has Ada, so a sync brings her in.
  const slackHasAda = () => {
    const id = slackId('U');

    t.slackApi.addOauthGrant(`grant-${id}`, {
      teamId: workspace.slackId,
      teamName: 'Acme',
      botToken: workspace.token,
      installerId: hr.slack_id,
    });
    t.slackApi.addUser({
      id,
      teamId: workspace.slackId,
      name: ADA,
      email: `${id.toLowerCase()}@example.test`,
    });

    return id;
  };

  // The OAuth install: the browser starts it, Slack sends it back with a code.
  const installApp = async (code: string) => {
    const start = await request(t.app.getHttpServer())
      .get('/api/slack/install')
      .expect(302);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    const cookie = ([start.headers['set-cookie']].flat() as string[])
      .find((value) => value.startsWith('slack_oauth_state='))!
      .split(';')[0];

    await request(t.app.getHttpServer())
      .get(`/api/slack/oauth/redirect?code=${code}&state=${state}`)
      .set('Cookie', cookie)
      .expect(302);
    await t.idle();
  };

  const questionsTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);
  const updatesOf = (message: IPostedMessage) =>
    t.slackApi.messageUpdates(workspace.token, message);
  const lastTextOf = (message: IPostedMessage) =>
    sectionTexts(updatesOf(message).pop() as View);
  const choose = async (
    user: Tables<'users'>,
    message: IPostedMessage,
    person: Tables<'users'>,
    team: Tables<'teams'>,
  ) => {
    await t.slack
      .actOnMessage(
        workspace,
        user,
        message,
        'choose_team',
        `${person.id}|${team.id}`,
      )
      .expect(200);
    await t.idle();
  };

  it('a person who joins after the install import gets HR a DM with the teams', async () => {
    await markImported();
    const ada = await join();

    const [question] = questionsTo(hr);
    expect(question.text).toBe(QUESTION);
    expect(question.blocks).toEqual([
      { type: 'section', text: { type: 'mrkdwn', text: QUESTION } },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Until then, ${ADA}'s requests go to HR or an admin.`,
          },
        ],
      },
      {
        type: 'actions',
        block_id: ViewCallbackId.NewPersonPrompt,
        elements: [
          {
            type: 'static_select',
            action_id: 'choose_team',
            placeholder: { type: 'plain_text', text: 'Choose a team' },
            options: [
              {
                text: { type: 'plain_text', text: 'Acme' },
                value: `${ada.id}|${acme.id}`,
              },
              {
                text: { type: 'plain_text', text: 'Beta' },
                value: `${ada.id}|${beta.id}`,
              },
            ],
          },
          {
            type: 'button',
            action_id: 'not_yet',
            text: { type: 'plain_text', text: 'Not yet' },
            value: `not_yet:${ada.id}`,
          },
        ],
      },
    ]);
    expect(questionsTo(hr2).map(({ text }) => text)).toEqual([QUESTION]);
    expect(
      (await workspace.rows('new_person_prompts'))
        .map(({ user_id, recipient_slack_id, channel, closed_at }) => ({
          user_id,
          recipient_slack_id,
          channel,
          closed_at,
        }))
        .sort((a, b) => a.channel.localeCompare(b.channel)),
    ).toEqual(
      [
        {
          user_id: ada.id,
          recipient_slack_id: hr.slack_id,
          channel: dmOf(hr),
          closed_at: null,
        },
        {
          user_id: ada.id,
          recipient_slack_id: hr2.slack_id,
          channel: dmOf(hr2),
          closed_at: null,
        },
      ].sort((a, b) => a.channel.localeCompare(b.channel)),
    );
  });

  it('names the second approval when the company rules have one', async () => {
    await markImported();
    await t.db
      .insertInto('rule_sets')
      .values({
        slack_team_id: workspace.id,
        is_default: true,
        hr_approvers: [hr.slack_id],
      })
      .execute();
    await join();

    expect(
      (questionsTo(hr)[0].blocks![1] as { elements: unknown[] }).elements,
    ).toEqual([
      {
        type: 'mrkdwn',
        text: `Until then, ${ADA}'s requests go to the company's second approval.`,
      },
    ]);
  });

  it('the install import asks nothing', async () => {
    const teamId = slackId('T');
    const installer = slackId('U');
    const member = slackId('U');
    installed.push(teamId);
    t.slackApi.addOauthGrant('install-code', {
      teamId,
      teamName: 'Fresh',
      botToken: `xoxb-${teamId}`,
      installerId: installer,
    });
    for (const [id, name] of [
      [installer, 'Ivy Installer'],
      [member, ADA],
    ]) {
      t.slackApi.addUser({
        id,
        teamId,
        name,
        email: `${id.toLowerCase()}@example.test`,
      });
    }

    await installApp('install-code');

    const row = await t.db
      .selectFrom('slack_teams')
      .select(['id', 'members_imported_at'])
      .where('slack_id', '=', teamId)
      .executeTakeFirstOrThrow();
    const users = await t.db
      .selectFrom('users')
      .select('slack_id')
      .where('slack_team_id', '=', row.id)
      .execute();

    expect(users.map(({ slack_id }) => slack_id).sort()).toEqual(
      [installer, member].sort(),
    );
    expect(row.members_imported_at).not.toBeNull();
    expect(
      t.slackApi
        .postedMessages(`xoxb-${teamId}`, installer)
        .map(({ text }) => text),
    ).toEqual([WELCOME_TEXT]);
    expect(
      await t.db
        .selectFrom('new_person_prompts')
        .select('id')
        .where('slack_team_id', '=', row.id)
        .execute(),
    ).toEqual([]);
  });

  it('a restore import asks nothing about the people it adds', async () => {
    await markImported();
    await t.db
      .updateTable('slack_teams')
      .set({ uninstalled_at: new Date().toISOString() })
      .where('id', '=', workspace.id)
      .execute();
    slackHasAda();
    t.slackApi.addOauthGrant('restore-code', {
      teamId: workspace.slackId,
      teamName: 'Acme',
      botToken: workspace.token,
      installerId: hr.slack_id,
    });

    await installApp('restore-code');

    expect(
      (await workspace.rows('users')).some(({ name }) => name === ADA),
    ).toBe(true);
    expect(questionsTo(hr)).toEqual([]);
    expect(await workspace.rows('new_person_prompts')).toEqual([]);
  });

  it('the daily sync asks about a person it adds', async () => {
    await markImported();
    slackHasAda();

    await t.app.get(MemberSyncScheduleService).syncAll();
    await t.idle();

    expect(questionsTo(hr).map(({ text }) => text)).toEqual([QUESTION]);
    expect(await workspace.rows('new_person_prompts')).toHaveLength(2);

    // The second run adds nobody and asks nothing more.
    await t.app.get(MemberSyncScheduleService).syncAll();
    await t.idle();
    expect(questionsTo(hr)).toHaveLength(1);
  });

  it('choosing a team places the person and updates every HR message', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    const [forHugo] = questionsTo(hr2);

    await choose(hr, forHana, ada, acme);

    expect((await workspace.row('users', ada.id)).team_id).toBe(acme.id);
    expect(lastTextOf(forHana)).toEqual([`✅ Hana HR placed ${ADA} in Acme.`]);
    expect(lastTextOf(forHugo)).toEqual([`✅ Hana HR placed ${ADA} in Acme.`]);
    expect(
      (await workspace.rows('new_person_prompts')).map(
        ({ closed_at }) => closed_at !== null,
      ),
    ).toEqual([true, true]);

    // A click on the stale message changes nothing.
    await choose(hr2, forHugo, ada, beta);
    expect((await workspace.row('users', ada.id)).team_id).toBe(acme.id);
    expect(
      t.slackApi
        .ephemeralMessages(workspace.token, hr2.slack_id)
        .map(({ text }) => text),
    ).toEqual([`${ADA} is already in Acme.`]);
  });

  it('Not yet closes the question for everyone and the person stays without a team', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    const [forHugo] = questionsTo(hr2);

    await t.slack.actOnMessage(workspace, hr, forHana, 'not_yet').expect(200);
    await t.idle();

    const closed = [`⏸ Hana HR left ${ADA} without a team for now.`];
    expect(lastTextOf(forHana)).toEqual(closed);
    expect(lastTextOf(forHugo)).toEqual(closed);
    expect((await workspace.row('users', ada.id)).team_id).toBeNull();
  });

  it('placing the person on People closes the open questions', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    const [forHugo] = questionsTo(hr2);
    const people = await openAppHomeTab(t, workspace, hr, [
      NavigationActionId.People,
    ]);
    const form = await openModalFrom(
      t,
      workspace,
      hr,
      people,
      UsersTabViewActionId.ManageUserMenu,
      `${UsersTabViewActionId.EditUser}:${ada.id}`,
    );

    await t.slack
      .submitView(workspace, hr, form, { team_id: beta.id })
      .expect(200);
    await t.idle();

    const closed = [`✅ Hana HR placed ${ADA} in Beta.`];
    expect(lastTextOf(forHana)).toEqual(closed);
    expect(lastTextOf(forHugo)).toEqual(closed);
  });

  it('the first of two answers at once wins, and the other is told', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    const [forHugo] = questionsTo(hr2);

    await Promise.all([
      t.slack
        .actOnMessage(
          workspace,
          hr,
          forHana,
          'choose_team',
          `${ada.id}|${acme.id}`,
        )
        .expect(200),
      t.slack
        .actOnMessage(
          workspace,
          hr2,
          forHugo,
          'choose_team',
          `${ada.id}|${beta.id}`,
        )
        .expect(200),
    ]);
    await t.idle();

    const placed = (await workspace.row('users', ada.id)).team_id;
    const winner = placed === acme.id ? 'Acme' : 'Beta';
    const by = placed === acme.id ? 'Hana HR' : 'Hugo HR';
    const told = [hr, hr2].flatMap((user) =>
      t.slackApi
        .ephemeralMessages(workspace.token, user.slack_id)
        .map(({ text }) => text),
    );

    expect(told).toEqual([`${ADA} is already in ${winner}.`]);
    expect(lastTextOf(forHana)).toEqual([
      `✅ ${by} placed ${ADA} in ${winner}.`,
    ]);
    expect(lastTextOf(forHugo)).toEqual([
      `✅ ${by} placed ${ADA} in ${winner}.`,
    ]);
  });

  it('asks nobody in a workspace with no teams', async () => {
    await markImported();
    await t.db
      .deleteFrom('teams')
      .where('slack_team_id', '=', workspace.id)
      .execute();

    await join();

    expect(questionsTo(hr)).toEqual([]);
    expect(await workspace.rows('new_person_prompts')).toEqual([]);
  });

  it('answers a choice for someone deactivated meanwhile and closes the questions', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    await t.db
      .updateTable('users')
      .set({ is_active: false })
      .where('id', '=', ada.id)
      .execute();

    await choose(hr, forHana, ada, acme);

    expect((await workspace.row('users', ada.id)).team_id).toBeNull();
    expect(
      t.slackApi
        .ephemeralMessages(workspace.token, hr.slack_id)
        .map(({ text }) => text),
    ).toEqual([`${ADA} is deactivated.`]);
    expect(lastTextOf(forHana)).toEqual([`⏸ ${ADA} is deactivated.`]);
  });

  it('answers a choice of a team deleted meanwhile', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    await t.db.deleteFrom('teams').where('id', '=', acme.id).execute();

    await choose(hr, forHana, ada, acme);

    expect(
      t.slackApi
        .ephemeralMessages(workspace.token, hr.slack_id)
        .map(({ text }) => text),
    ).toEqual(['That team no longer exists.']);
    expect((await workspace.row('users', ada.id)).team_id).toBeNull();
  });

  it('tells a second Not yet that the question is closed', async () => {
    await markImported();
    await join();
    const [forHana] = questionsTo(hr);

    await t.slack.actOnMessage(workspace, hr, forHana, 'not_yet').expect(200);
    await t.idle();
    const again = await t.slack
      .actOnMessage(workspace, hr, forHana, 'not_yet')
      .expect(200);
    await t.idle();

    expect(again.status).toBe(200);
    expect(
      t.slackApi
        .ephemeralMessages(workspace.token, hr.slack_id)
        .map(({ text }) => text),
    ).toEqual(['This question is no longer open. Nothing changed.']);
  });

  it('keeps at most 100 teams, each option cut to 75 characters', async () => {
    await markImported();
    const long = `A${'x'.repeat(79)}`;
    await workspace.addTeam({ name: long });
    for (let i = 0; i < 100; i++) {
      await workspace.addTeam({ name: `Team ${String(i).padStart(3, '0')}` });
    }

    await join();

    const select = (
      questionsTo(hr)[0].blocks![2] as {
        elements: { options?: { text: { text: string } }[] }[];
      }
    ).elements[0];
    const texts = select.options!.map(({ text }) => text.text);

    expect(texts).toHaveLength(100);
    expect(texts.slice(0, 3)).toEqual([
      'Acme',
      `A${'x'.repeat(71)}...`,
      'Beta',
    ]);
    expect(texts[1]).toHaveLength(75);
  });

  it('a member cannot answer the question', async () => {
    await markImported();
    const ada = await join();
    const [forHana] = questionsTo(hr);
    const member = await workspace.addUser({ name: 'Mia Member' });

    await t.slack
      .actOnMessage(
        workspace,
        member,
        forHana,
        'choose_team',
        `${ada.id}|${acme.id}`,
      )
      .expect(200);
    await t.idle();

    expect((await workspace.row('users', ada.id)).team_id).toBeNull();
    expect(updatesOf(forHana)).toEqual([]);
  });
});
