import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { IPostedMessage } from './support/fake-slack-api.client';
import { sectionTexts } from './support/tab-readers';
import { dmOf } from './support/team-file';

const ADA = 'Ada Lovelace';
const QUESTION = `👋 *${ADA}* joined Slack. Which team is ${ADA} on?`;

describe('New people', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let hr2: Tables<'users'>;
  let acme: Tables<'teams'>;
  let beta: Tables<'teams'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

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
    const id = slackHasAda();

    await t.app.get(MemberSyncScheduleService).syncAll();
    await t.idle();

    expect(
      (await workspace.rows('users')).some(({ slack_id }) => slack_id === id),
    ).toBe(true);
    expect(questionsTo(hr)).toEqual([]);
    expect(await workspace.rows('new_person_prompts')).toEqual([]);
    expect(
      (
        await t.db
          .selectFrom('slack_teams')
          .select('members_imported_at')
          .where('id', '=', workspace.id)
          .executeTakeFirstOrThrow()
      ).members_imported_at,
    ).not.toBeNull();
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

    await t.app
      .get(UsersService)
      .assignTeams(
        [{ userId: ada.id, teamId: beta.id }],
        hr as unknown as IUserViewModel,
      );
    await t.idle();

    const closed = [`✅ Hana HR placed ${ADA} in Beta.`];
    expect(lastTextOf(forHana)).toEqual(closed);
    expect(lastTextOf(forHugo)).toEqual(closed);
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
