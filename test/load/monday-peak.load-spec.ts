import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Logger } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import type { Response } from 'supertest';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { parseCellKey } from '@modules/slack/tabs/time-tracking/utils/timesheet-cell-key';
import { TimeEntryRemindersService } from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';
import { createTestApp, ITestApp } from 'test/integration/support/test-app';
import { TestWorkspace } from 'test/integration/support/test-workspace';
import { travelTo } from 'test/integration/support/clock';
import { acknowledged } from 'test/integration/support/slack-test-client';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
} from 'test/integration/support/app-home';
import { LoadSlackApiClient } from './support/load-slack-api.client';
import { deleteCompany, ILoadCompany, seedCompany } from './support/seed';
import {
  forEachAtMost,
  IPercentiles,
  percentiles,
  sleep,
  watchEventLoop,
  watchPoolWaits,
} from './support/timings';
import { formatReport, ILoadReport } from './support/report';

// Monday 09:00 UTC: the weekly reminder goes out, and people fill in and
// submit last week.
const MONDAY = '2026-06-15';
const YEAR = { fromDate: '2025-06-15', toDate: '2026-06-14' };

// Every statement comes back this much later, as with the app in another
// region than its database (the case dvovna/logbook#68 warns about): in its
// region a round trip takes about 1 ms.
const SQL_LATENCY_MS = Number(process.env.SQL_LATENCY_MS ?? 100);
// Every call to Slack takes this long (the fake answers at once).
const SLACK_LATENCY_MS = Number(process.env.SLACK_LATENCY_MS ?? 150);
// Bursts, this far apart, while the reminders go out.
const WAVES = Number(process.env.LOAD_WAVES ?? 3);
const WAVE_GAP_MS = Number(process.env.LOAD_WAVE_GAP_MS ?? 10_000);
// Multiplies the clicks of a burst (BURST).
const SCALE = Number(process.env.LOAD_SCALE ?? 1);

// Slack shows a request as failed after 3 seconds; keep room for the network.
const ANSWER_LIMIT_MS = 2500;

// What a burst holds, everyone at the same moment: people opening Home,
// opening last week's form, saving and submitting it, managers opening
// Approvals, a company-wide and a team's time report of the year, and a
// CSV of the company's year.
const BURST = {
  homeOpens: 40,
  weekForms: 10,
  weekSaves: 20,
  approvals: 6,
};

type ActionKind =
  | 'open Home'
  | 'open the week form'
  | 'save and submit the week'
  | 'open Approvals'
  | 'show a time report of the year'
  | 'export a CSV of the year';

interface IAction {
  kind: ActionKind;
  user: Tables<'users'>;
  send: () => PromiseLike<Response>;
  // The screen published after the answer, or the file shared.
  screen?: ViewCallbackId | 'file';
  check?: (response: Response) => void;
}

interface IDone {
  kind: ActionKind;
  wave: number;
  user: string;
  sentAt: number;
  answerMs: number;
  screen?: ViewCallbackId | 'file';
  error?: string;
}

// Opens the screens of `users` in setup, a few at a time.
const SETUP_CONCURRENCY = 8;

// The people of `pool` for wave `wave` of `perWave` each, none twice.
const take = <T>(pool: T[], wave: number, perWave: number) =>
  pool.slice(wave * perWave, (wave + 1) * perWave);

// How Logbook answers at the Monday peak of a company of 400 people: a
// burst of clicks, everyone at once, while the weekly reminder goes out, with
// a database 100 ms away. Every answer must come within Slack's 3 seconds
// (2.5 s, to leave room for the network). Prints the answer times and how
// long people waited for their screens; LOAD_REPORT=<file> writes them as
// JSON. See README → "Load test".
describe('The Monday peak', () => {
  let t: ITestApp;
  let slackApi: LoadSlackApiClient;
  let workspace: TestWorkspace;
  let company: ILoadCompany;

  beforeAll(async () => {
    slackApi = new LoadSlackApiClient();
    t = await createTestApp({ slackApi });
    // The test calls the reminder itself, for its workspace only: the
    // timer would remind every workspace of the local database.
    t.app.get(TimeEntryRemindersService).onModuleDestroy();
    workspace = await TestWorkspace.create(t.db);
    company = await seedCompany(t.db, workspace);
  }, 300_000);

  afterAll(async () => {
    await t.idle();
    await deleteCompany(t.db, workspace);
    await t.close();
  }, 300_000);

  const homeOf = async (user: Tables<'users'>, path: string[] = []) =>
    openAppHomeTab(t, workspace, user, path);

  const lastWeekOf = async (user: Tables<'users'>) =>
    actOnTab(
      t,
      workspace,
      user,
      await homeOf(user, [NavigationActionId.MyTime]),
      TimeEntriesTabViewActionId.PreviousWeek,
    );

  // A draft's cell of the week form, with another number of hours.
  const changedCell = (form: View) => {
    for (const block of form.blocks) {
      const element = (
        block as { element?: { action_id?: string; initial_value?: string } }
      ).element;

      if (
        block.type === 'input' &&
        element?.action_id &&
        parseCellKey(element.action_id) &&
        element.initial_value
      ) {
        const hours = Number(element.initial_value);

        return {
          [element.action_id]: String(hours >= 8 ? hours - 1 : hours + 1),
        };
      }
    }

    throw new Error('The week form has no draft to change');
  };

  it('answers every click within Slack’s 3 seconds', async () => {
    travelTo(MONDAY);
    const { admin, hr, finance, managers, members, withDrafts } = company;
    const companyViewers = [admin, ...hr, ...finance];
    const perWave = (count: number) => Math.round(count * SCALE);
    const savers = withDrafts.slice(0, perWave(BURST.weekSaves) * WAVES);
    const formOpeners = withDrafts.slice(
      savers.length,
      savers.length + perWave(BURST.weekForms) * WAVES,
    );
    const homeOpeners = members.filter(
      (member) => !withDrafts.includes(member),
    );
    const approvers = managers.slice(0, -2);
    const teamReporters = managers.slice(-2);
    // Half of the people who see everyone's time show a report, the other
    // half export one.
    const companyReporters = companyViewers.slice(0, 3);
    const exporters = companyViewers.slice(3);

    // Setup, before the latency: the screens each person clicks on.
    const forms = new Map<string, View>();
    const lastWeeks = new Map<string, View>();
    const homes = new Map<string, View>();
    const reportForms = new Map<string, View>();
    const reports = new Map<string, View>();

    await forEachAtMost(
      [...savers, ...formOpeners],
      SETUP_CONCURRENCY,
      async (user) => {
        lastWeeks.set(user.slack_id, await lastWeekOf(user));
      },
    );
    // One at a time: openModalFrom takes the last modal opened.
    for (const user of savers) {
      forms.set(
        user.slack_id,
        await openModalFrom(
          t,
          workspace,
          user,
          lastWeeks.get(user.slack_id)!,
          TimeEntriesTabViewActionId.FillWeek,
        ),
      );
    }
    await forEachAtMost(approvers, SETUP_CONCURRENCY, async (user) => {
      homes.set(user.slack_id, await homeOf(user));
    });
    const reporters = [...companyViewers, ...teamReporters];
    for (const user of reporters) {
      const reportsTab = await homeOf(user, [NavigationActionId.Reports]);

      reportForms.set(
        user.slack_id,
        await openModalFrom(
          t,
          workspace,
          user,
          reportsTab,
          ReportsTabActionId.TimeReport,
        ),
      );
    }
    // The CSV is of the report on show.
    for (const user of exporters) {
      const since = slackApi.mark();

      await t.slack
        .submitView(workspace, user, reportForms.get(user.slack_id)!, {
          kind: TimeReportKind.Project,
          ...YEAR,
        })
        .expect(200);
      await t.idle();
      reports.set(
        user.slack_id,
        slackApi.homeView(workspace.token, user.slack_id, { since }),
      );
    }

    const reportOf = (user: Tables<'users'>, kind: TimeReportKind) => ({
      kind: 'show a time report of the year' as const,
      user,
      screen: ViewCallbackId.ReportsTabView,
      send: () =>
        t.slack
          .submitView(workspace, user, reportForms.get(user.slack_id)!, {
            kind,
            ...YEAR,
          })
          .expect(200),
    });

    const burst = (wave: number): (IAction & { wave: number })[] =>
      (
        [
          ...take(homeOpeners, wave, perWave(BURST.homeOpens)).map((user) => ({
            kind: 'open Home' as const,
            user,
            screen: ViewCallbackId.HomeTabView,
            send: () =>
              t.slack
                .event(workspace, {
                  type: 'app_home_opened',
                  user: user.slack_id,
                  tab: 'home',
                })
                .expect(acknowledged),
          })),
          ...take(formOpeners, wave, perWave(BURST.weekForms)).map((user) => ({
            kind: 'open the week form' as const,
            user,
            send: () =>
              t.slack
                .actOnView(
                  workspace,
                  user,
                  lastWeeks.get(user.slack_id)!,
                  TimeEntriesTabViewActionId.FillWeek,
                )
                .expect(200),
          })),
          ...take(savers, wave, perWave(BURST.weekSaves)).map((user) => {
            const form = forms.get(user.slack_id)!;

            return {
              kind: 'save and submit the week' as const,
              user,
              screen: ViewCallbackId.TimeEntriesTabView,
              send: () =>
                t.slack
                  .submitView(workspace, user, form, {
                    ...changedCell(form),
                    [TimesheetFormActionId.SubmitWeek]: ['submit'],
                  })
                  .expect(200),
              check: (response: Response) =>
                expect(response.body).toEqual({ response_action: 'clear' }),
            };
          }),
          ...take(approvers, wave, perWave(BURST.approvals)).map((user) => ({
            kind: 'open Approvals' as const,
            user,
            screen: ViewCallbackId.ApprovalsTabView,
            send: () =>
              t.slack
                .actOnView(
                  workspace,
                  user,
                  homes.get(user.slack_id)!,
                  NavigationActionId.Approvals,
                )
                .expect(200),
          })),
          reportOf(
            companyReporters[wave % companyReporters.length],
            TimeReportKind.Person,
          ),
          reportOf(
            teamReporters[wave % teamReporters.length],
            TimeReportKind.Project,
          ),
          ...(exporters[wave]
            ? [
                {
                  kind: 'export a CSV of the year' as const,
                  user: exporters[wave],
                  screen: 'file' as const,
                  send: () =>
                    t.slack
                      .actOnView(
                        workspace,
                        exporters[wave],
                        reports.get(exporters[wave].slack_id)!,
                        ReportsTabActionId.ExportTimeReport,
                      )
                      .expect(200),
                },
              ]
            : []),
        ] as IAction[]
      ).map((action) => ({ ...action, wave }));

    // The burst, with a database far away.
    await t.idle();
    t.sql.setLatency(SQL_LATENCY_MS);
    slackApi.latencyMs = SLACK_LATENCY_MS;
    const errors = jest.spyOn(Logger.prototype, 'error');
    const poolWaits = watchPoolWaits();
    const eventLoop = watchEventLoop();
    const sqlSince = t.sql.mark();
    const shownSince = slackApi.shown.length;
    const done: IDone[] = [];

    const run = async (action: IAction & { wave: number }) => {
      const sentAt = performance.now();
      let answeredAt: number | undefined;
      let error: string | undefined;

      try {
        const response = await action.send();

        answeredAt = performance.now();
        action.check?.(response);
      } catch (failure) {
        error = (failure as Error).message;
      }

      done.push({
        kind: action.kind,
        wave: action.wave,
        user: action.user.slack_id,
        sentAt,
        answerMs: (answeredAt ?? performance.now()) - sentAt,
        screen: action.screen,
        error,
      });
    };

    const start = performance.now();
    const reminders = t.app
      .get(TimeEntryRemindersService)
      .remindWorkspace(workspace.id, MONDAY);
    const bursts: Promise<unknown>[] = [];

    for (let wave = 0; wave < WAVES; wave += 1) {
      if (wave) {
        await sleep(WAVE_GAP_MS);
      }

      bursts.push(Promise.all(burst(wave).map(run)));
    }

    await Promise.all(bursts);
    const reminded = await reminders;
    await t.idle();
    const elapsed = performance.now() - start;
    const loop = eventLoop();

    poolWaits.stop();
    t.sql.setLatency(0);
    slackApi.latencyMs = 0;

    // How long each person waited for what their click shows after the
    // answer: the first screen of its kind published to them, or the file.
    const shown = slackApi.shown.slice(shownSince);
    const screenMs = (action: IDone) => {
      const dm = `D${action.user.slice(1)}`;
      const first = shown.find((call) =>
        action.screen === 'file'
          ? call.method === 'files.completeUploadExternal' && call.to === dm
          : call.method === 'views.publish' &&
            call.to === action.user &&
            call.callbackId === action.screen &&
            call.at > action.sentAt,
      );

      return first && first.at - action.sentAt;
    };
    const fallbacks = shown.filter(
      ({ callbackId }) => callbackId === ViewCallbackId.FallbackTabView,
    );
    const reminderMessages = shown.filter(
      ({ method, text }) =>
        method === 'chat.postMessage' && text?.startsWith(':alarm_clock:'),
    );
    const kinds = [...new Set(done.map(({ kind }) => kind))];
    const byKind = Object.fromEntries(
      kinds.map((kind) => {
        const ofKind = done.filter((action) => action.kind === kind);
        const screens = ofKind
          .filter(({ screen }) => screen)
          .map(screenMs)
          .filter((ms): ms is number => ms !== undefined);

        return [
          kind,
          {
            answer: percentiles(ofKind.map(({ answerMs }) => answerMs)),
            ...(screens.length ? { screen: percentiles(screens) } : {}),
          },
        ];
      }),
    ) as Record<string, { answer: IPercentiles; screen?: IPercentiles }>;
    const missingScreens = done.filter(
      (action) => action.screen && screenMs(action) === undefined,
    );
    const slow = done.filter(({ answerMs }) => answerMs > ANSWER_LIMIT_MS);
    const failed = done.filter(({ error }) => error);
    const statements = t.sql.statements(sqlSince);

    const report: ILoadReport = {
      setup: {
        people: members.length + managers.length + companyViewers.length,
        entries: company.entries,
        sqlLatencyMs: SQL_LATENCY_MS,
        slackLatencyMs: SLACK_LATENCY_MS,
        poolSize: Number(process.env.DATABASE_POOL_SIZE),
        jobsConcurrency: Number(process.env.JOBS_CONCURRENCY),
        waves: WAVES,
        waveGapMs: WAVE_GAP_MS,
        clicksPerWave: done.length / WAVES,
      },
      answers: percentiles(done.map(({ answerMs }) => answerMs)),
      byKind,
      overLimit: slow.map(({ kind, wave, answerMs, error }) => ({
        kind,
        wave,
        ms: Math.round(answerMs),
        error,
      })),
      reminders: {
        people: reminded,
        sent: reminderMessages.length,
        lastAfterMs: Math.round(
          Math.max(0, ...reminderMessages.map(({ at }) => at - start)),
        ),
      },
      poolWaitMs: {
        ...percentiles(poolWaits.waits),
        timeouts: poolWaits.timeouts,
      },
      eventLoopDelayMs: loop,
      statements: {
        count: statements.length,
        background: statements.filter(({ background }) => background).length,
      },
      elapsedMs: Math.round(elapsed),
      errors: errors.mock.calls.map(([message]) => String(message)),
    };

    errors.mockRestore();

    if (process.env.LOAD_REPORT) {
      writeFileSync(process.env.LOAD_REPORT, JSON.stringify(report, null, 2));
    }

    process.stdout.write(`${formatReport(report, ANSWER_LIMIT_MS)}\n`);

    // The details are in the report above.
    expect({
      answersOverLimit: slow.length,
      otherFailedClicks: failed
        .filter(({ answerMs }) => answerMs <= ANSWER_LIMIT_MS)
        .map(({ kind, error }) => `${kind}: ${error}`),
      errorsLogged: report.errors.length,
      fallbackScreens: fallbacks.length,
      screensNeverShown: missingScreens.length,
    }).toEqual({
      answersOverLimit: 0,
      otherFailedClicks: [],
      errorsLogged: 0,
      fallbackScreens: 0,
      screensNeverShown: 0,
    });
    expect(report.reminders.sent).toBeGreaterThan(0);
  }, 600_000);
});
