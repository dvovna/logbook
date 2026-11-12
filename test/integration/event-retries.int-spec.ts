import { randomUUID } from 'node:crypto';
import UserRole from '@common/enums/user-role.enum';
import { JobsService } from '@common/jobs/jobs.service';
import { Tables } from '@common/types/database.types';
import { SlackEventReceiptsService } from '@modules/slack-teams/slack-event-receipts.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { travelTo } from './support/clock';

// What Slack adds when it sends an event again because the app's answer
// took over 3 seconds.
const RETRY_HEADERS = {
  'X-Slack-Retry-Num': '1',
  'X-Slack-Retry-Reason': 'http_timeout',
};

// Slack sends an event again when it got no answer within 3 seconds, and the
// app saves the event's job before it answers: only the first delivery of
// an event starts one.
describe('Slack event retries', () => {
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

  afterEach(() => jest.restoreAllMocks());

  // An admin shares a file the app doesn't import: its job reads the file's
  // info and tells the admin, once per run.
  const fileShared = (eventId = `Ev${randomUUID().slice(0, 8)}`) => ({
    type: 'event_callback',
    team_id: workspace.slackId,
    api_app_id: 'A_TEST',
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    event: {
      type: 'file_shared',
      file_id: t.slackApi.addFile('notes.txt', 'hello'),
      user_id: admin.slack_id,
      channel_id: 'D_TEST',
    },
  });

  const jobRuns = () => ({
    fileInfos: t.slackApi.callsWith(workspace.token, 'files.info').length,
    replies: t.slackApi.ephemeralMessages(workspace.token, admin.slack_id)
      .length,
  });

  it('starts one job for an event Slack sends again', async () => {
    const event = fileShared();

    await t.slack.rawEvent(event).expect(acknowledged);
    await t.idle();
    await t.slack.rawEvent(event, RETRY_HEADERS).expect(acknowledged);
    await t.slack
      .rawEvent(event, { ...RETRY_HEADERS, 'X-Slack-Retry-Num': '2' })
      .expect(acknowledged);
    await t.idle();
    await t.retryJobs();

    expect(jobRuns()).toEqual({ fileInfos: 1, replies: 1 });
  });

  // The second delivery waits for the first one's transaction.
  it('starts one job when the deliveries come at once', async () => {
    const event = fileShared();

    await Promise.all([
      t.slack.rawEvent(event).expect(acknowledged),
      t.slack.rawEvent(event, RETRY_HEADERS).expect(acknowledged),
    ]);
    await t.idle();
    await t.retryJobs();

    expect(jobRuns()).toEqual({ fileInfos: 1, replies: 1 });
  });

  it('starts a job for each event', async () => {
    await t.slack.rawEvent(fileShared()).expect(acknowledged);
    await t.slack.rawEvent(fileShared()).expect(acknowledged);
    await t.idle();

    expect(jobRuns()).toEqual({ fileInfos: 2, replies: 2 });
  });

  // The receipt and the job are saved in one transaction.
  it("takes the event again when its job couldn't be saved", async () => {
    const event = fileShared();
    jest
      .spyOn(JobsService.prototype, 'enqueue')
      .mockRejectedValueOnce(new Error('connection lost'));

    await t.slack.rawEvent(event).expect(500);
    await t.idle();
    await t.slack.rawEvent(event, RETRY_HEADERS).expect(acknowledged);
    await t.idle();

    expect(jobRuns()).toEqual({ fileInfos: 1, replies: 1 });
  });

  it('forgets an event an hour after it came', async () => {
    const event = fileShared();
    await t.slack.rawEvent(event).expect(acknowledged);
    await t.idle();
    expect(await workspace.rows('slack_event_receipts')).toEqual([
      expect.objectContaining({ event_id: event.event_id }),
    ]);

    await t.app.get(SlackEventReceiptsService).deleteOld();
    expect(await workspace.rows('slack_event_receipts')).toHaveLength(1);

    travelTo('2026-06-18');
    await t.app.get(SlackEventReceiptsService).deleteOld();

    expect(await workspace.rows('slack_event_receipts')).toEqual([]);
  });
});
