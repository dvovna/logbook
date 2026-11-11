import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { SLACK_BODY_LIMIT_BYTES } from '@common/middlewares/slack-body-parser.middleware';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { actionPayload, findAction } from './support/block-kit';
import { actionIdsOf, tableRows } from './support/tab-readers';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Names in Cyrillic: a letter is two bytes in UTF-8 and six once
// URL-encoded, as Slack sends an interaction. Letters, not digits, tell them
// apart.
const LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЩЭЮЯ';
const name = (words: string, index: number) =>
  `${words} ${LETTERS[Math.floor(index / LETTERS.length)]}${LETTERS[index % LETTERS.length]}`;

// App Home clicks carry the whole view, and Express refuses a body over its
// limit before the app sees it: a click on the biggest screen must fit with
// room to spare.
describe('Size of the requests Slack sends', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
  });

  // A click on `view` with the fields Slack adds to what
  // SlackTestClient.actOnView sends, and `padding` characters more.
  const click = (view: View, actionId: string, padding = 0) => ({
    type: 'block_actions',
    user: {
      id: admin.slack_id,
      username: 'admin',
      name: 'admin',
      team_id: workspace.slackId,
    },
    api_app_id: 'A0123456789',
    token: 'verification-token-of-the-app',
    container: { type: 'view', view_id: 'V0123456789' },
    trigger_id: '1234567890123.1234567890123.0123456789abcdef0123456789abcdef',
    team: { id: workspace.slackId, domain: 'example' },
    enterprise: null,
    is_enterprise_install: false,
    view: {
      id: 'V0123456789',
      team_id: workspace.slackId,
      ...view,
      state: { values: {} },
      hash: '1234567890.abcdefgh',
      clear_on_close: false,
      notify_on_close: false,
      close: null,
      submit: null,
      previous_view_id: null,
      root_view_id: 'V0123456789',
      app_id: 'A0123456789',
      external_id: '',
      app_installed_team_id: workspace.slackId,
      bot_id: 'B0123456789',
    },
    actions: [actionPayload(findAction(view.blocks, actionId))],
    ...(padding ? { padding: 'x'.repeat(padding) } : {}),
  });

  const bodySize = (payload: object) =>
    Buffer.byteLength(
      new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
    );

  // The billing report's table holds 100 rows of 6 cells and 10000
  // characters, and By project and By person list up to 40 names each: 10
  // projects (the most a test workspace has) and 40 people, each on 3 of
  // them, make 120 lines with names as long as fit.
  const biggestReport = async (): Promise<View> => {
    const client = await workspace.addClient({ name: name('Клиент', 0) });
    const projects = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        workspace.addProject({
          name: name('Проект Константинопольской области Востока', index),
          client_id: client.id,
          hourly_rate: 1,
        }),
      ),
    );
    const people = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        workspace.addUser({
          name: name('Александра Константинопольская-Юрьевна', index),
        }),
      ),
    );

    await Promise.all(
      people.map((person, index) =>
        workspace.addTimeEntries(
          person,
          projects[index % projects.length],
          [0, 1, 2].map((offset) => ({
            project_id: projects[(index + offset) % projects.length].id,
            work_date: '2026-06-01',
            minutes: 15,
            status: TimeEntryStatus.Approved,
          })),
        ),
      ),
    );

    const form = await openModalFrom(
      t,
      workspace,
      admin,
      await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
      ReportsTabActionId.BillingReport,
    );
    const since = t.slackApi.mark();

    await t.slack
      .submitView(workspace, admin, form, {
        clientId: client.id,
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      })
      .expect(200);

    return publishedHome(t, workspace, admin, since);
  };

  it('takes a click on the biggest report, which is over the 100 KB Express takes by default', async () => {
    const report = await biggestReport();
    const payload = click(report, NavigationActionId.MyTime);

    expect(tableRows(report).length).toBeGreaterThan(90);
    expect(bodySize(payload)).toBeGreaterThan(100 * 1024);
    expect(bodySize(payload)).toBeLessThan(SLACK_BODY_LIMIT_BYTES / 4);

    const since = t.slackApi.mark();
    await t.slack.interaction(payload).expect(200);

    expect(
      actionIdsOf(await publishedHome(t, workspace, admin, since)),
    ).toContain(TimeEntriesTabViewActionId.FillWeek);
  });

  it('takes a body up to its limit and refuses a bigger one', async () => {
    const home = await openAppHomeTab(t, workspace, admin);
    const base = bodySize(click(home, NavigationActionId.MyTime));
    const fill = (size: number) =>
      click(home, NavigationActionId.MyTime, size - base);

    await t.slack.interaction(fill(SLACK_BODY_LIMIT_BYTES - 1024)).expect(200);
    await t.slack.interaction(fill(SLACK_BODY_LIMIT_BYTES + 1024)).expect(413);
  });
});
