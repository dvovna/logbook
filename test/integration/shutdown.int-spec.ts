import { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import UserRole from '@common/enums/user-role.enum';
import delay from '@common/utils/delay';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Something the test lets go on when it wants to, and knows has started.
const gate = () => {
  let reach = () => {};
  let open = () => {};
  const reached = new Promise<void>((resolve) => (reach = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));

  return { reach, reached, open, opened };
};

// The server stops listening once the shutdown starts, well before the
// work in flight is done (SHUTDOWN_GRACE_MS).
const stopsListening = async (server: Server) => {
  const deadline = performance.now() + 2_000;

  while (server.listening) {
    if (performance.now() > deadline) {
      throw new Error('The app still takes new connections');
    }

    await delay(5);
  }
};

// app.close() runs the hooks SIGTERM runs (main.ts): the app stops taking
// requests first, then waits for the requests and the work in flight, and
// closes after them. Each test closes its own app.
describe('Shutdown', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    t = await createTestApp();
    workspace = await t.createWorkspace();
    server = t.app.getHttpServer();
    ({ port } = server.address() as AddressInfo);
  });

  afterEach(() => jest.restoreAllMocks());

  const refusesNewRequests = () =>
    expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();

  it('takes no new request, answers the one in flight, then closes', async () => {
    const admin = await workspace.addUser({ role: UserRole.Admin });
    // Reports is in the navigation of a workspace that tracks time.
    await workspace.addProject();
    const reports = await openAppHomeTab(t, workspace, admin, [
      NavigationActionId.Reports,
    ]);
    // The click answers once its form is open, which waits for the test.
    const slack = gate();
    const openView = t.slackApi.openView.bind(t.slackApi);
    jest.spyOn(t.slackApi, 'openView').mockImplementation(async (...args) => {
      slack.reach();
      await slack.opened;

      return openView(...args);
    });

    const click = t.slack
      .actOnView(workspace, admin, reports, ReportsTabActionId.TimeReport)
      .then(({ status }) => status);
    await slack.reached;

    let closed = false;
    const closing = t.close().then(() => (closed = true));

    await stopsListening(server);
    await refusesNewRequests();

    slack.open();
    expect(await click).toBe(200);
    expect(closed).toBe(false);

    await closing;
    expect(t.slackApi.callsWith(workspace.token, 'views.open')).toHaveLength(1);
  });

  it('finishes a CSV export in flight before it closes', async () => {
    const admin = await workspace.addUser({ role: UserRole.Admin });
    const project = await workspace.addProject({ name: 'Website' });
    await workspace.addTimeEntry(admin, project, {
      status: TimeEntryStatus.Approved,
      work_date: '2026-06-10',
    });
    const form = await openModalFrom(
      t,
      workspace,
      admin,
      await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
      ReportsTabActionId.TimeReport,
    );
    const since = t.slackApi.mark();
    await t.slack
      .submitView(workspace, admin, form, {
        kind: TimeReportKind.Project,
        fromDate: '2026-06-01',
        toDate: '2026-06-30',
      })
      .expect(200);
    const reports = await publishedHome(t, workspace, admin, since);
    // The job's upload waits for the test.
    const upload = gate();
    const uploadFile = t.slackApi.uploadFile.bind(t.slackApi);
    jest.spyOn(t.slackApi, 'uploadFile').mockImplementation(async (...args) => {
      upload.reach();
      await upload.opened;

      return uploadFile(...args);
    });

    await t.slack
      .actOnView(workspace, admin, reports, ReportsTabActionId.ExportTimeReport)
      .expect(200);
    await upload.reached;

    let closed = false;
    const closing = t.close().then(() => (closed = true));

    await stopsListening(server);
    await refusesNewRequests();
    expect(closed).toBe(false);

    upload.open();
    await closing;

    expect(
      t.slackApi.uploadedFiles(workspace.token, `D${admin.slack_id.slice(1)}`, {
        since,
      }),
    ).toHaveLength(1);
  });
});
