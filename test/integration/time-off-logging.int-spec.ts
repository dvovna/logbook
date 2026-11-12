import { ForbiddenException } from '@nestjs/common';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { formatDateList, formatDateRange } from '@common/utils/date.utils';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { UsersService } from '@modules/users/services/users.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actionIdsOf,
  buttonText,
  noticeOf,
  sectionTexts,
} from './support/tab-readers';
import { textOf } from './support/block-kit';
import { addDays, workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';
import { acknowledged } from './support/slack-test-client';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

const PROJECTS_TAB = [NavigationActionId.Projects];

describe('Time off logging', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
  });

  describe('Settings', () => {
    const settings = () => t.app.get(TimeOffSettingsService);

    const openSettings = async (user = admin) =>
      openModalFrom(
        t,
        workspace,
        user,
        await openAppHomeTab(t, workspace, user, PROJECTS_TAB),
        ProjectsTabViewActionId.TimeOffSettings,
      );

    const storedRows = () =>
      t.db
        .selectFrom('time_off_projects')
        .selectAll()
        .where('slack_team_id', '=', workspace.id)
        .execute();

    const fieldIds = (modal: View) =>
      (modal.blocks as { type: string; element?: { action_id: string } }[])
        .filter((block) => block.type === 'input')
        .map((block) => block.element?.action_id);

    it('lets an admin pick a project per leave type and the hours of a day', async () => {
      const vacations = await workspace.addProject({ name: 'Vacations' });
      const sick = await workspace.addProject({ name: 'Sick' });
      const modal = await openSettings();

      expect(fieldIds(modal)).toEqual([
        'hours',
        'annual_leave',
        'bonus_day',
        'sick_leave',
        'unpaid_leave',
      ]);

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, modal, {
          hours: '7.5',
          annual_leave: vacations.id,
          sick_leave: sick.id,
        })
        .expect(200);
      const tab = await publishedHome(t, workspace, admin, since);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(tab)).toBe('✅ Time off projects saved.');
      expect(await settings().get(workspace.id)).toEqual({
        minutesPerDay: 450,
        projectIds: { annual_leave: vacations.id, sick_leave: sick.id },
      });

      const reopened = (await openSettings()).blocks as {
        element: { initial_value?: string; initial_option?: { value: string } };
      }[];
      expect(reopened[0].element.initial_value).toBe('7.5');
      expect(reopened[1].element.initial_option?.value).toBe(vacations.id);
    });

    it('clears a leave type left empty, and one whose project was archived', async () => {
      const vacations = await workspace.addProject({ name: 'Vacations' });
      await workspace.addProject({ name: 'Other' });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: 'annual_leave',
          project_id: vacations.id,
        })
        .execute();
      await t.db
        .updateTable('projects')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', vacations.id)
        .execute();

      const modal = await openSettings();
      expect(
        (modal.blocks as { element: { initial_option?: unknown } }[])[1].element
          .initial_option,
      ).toBeUndefined();

      await t.slack.submitView(workspace, admin, modal).expect(200);

      expect(await storedRows()).toEqual([]);
    });

    describe('on Projects', () => {
      const INTRO =
        'Approved time off can be logged as time on a project of its leave type.';

      const setupLine = async (user = admin) =>
        sectionTexts(
          await openAppHomeTab(t, workspace, user, PROJECTS_TAB),
        ).find((text) => text.startsWith(INTRO));

      it('says what is set, by leave type, and the hours of a day', async () => {
        const vacations = await workspace.addProject({ name: 'Vacations' });
        const sick = await workspace.addProject({ name: 'R&D <Sick>' });
        const modal = await openSettings();

        expect(await setupLine()).toBe(
          `${INTRO}\nNo leave type has a project yet.`,
        );

        const since = t.slackApi.mark();
        await t.slack
          .submitView(workspace, admin, modal, {
            hours: '7.5',
            sick_leave: sick.id,
            annual_leave: vacations.id,
          })
          .expect(200);

        // The tab the form goes back to shows it at once.
        expect(
          sectionTexts(await publishedHome(t, workspace, admin, since)).find(
            (text) => text.startsWith(INTRO),
          ),
        ).toBe(
          `${INTRO}\nAnnual leave → Vacations · Sick leave → R&amp;D &lt;Sick&gt; · 7h 30m a day`,
        );
      });

      it('shows a leave type whose project was archived as not set', async () => {
        const vacations = await workspace.addProject({ name: 'Vacations' });
        await t.db
          .insertInto('time_off_projects')
          .values({
            slack_team_id: workspace.id,
            vacation_type: 'annual_leave',
            project_id: vacations.id,
          })
          .execute();

        expect(await setupLine()).toBe(
          `${INTRO}\nAnnual leave → Vacations · 8h a day`,
        );

        await t.db
          .updateTable('projects')
          .set({ archived_at: new Date().toISOString() })
          .where('id', '=', vacations.id)
          .execute();

        expect(await setupLine()).toBe(
          `${INTRO}\nNo leave type has a project yet.`,
        );
      });

      it('is shown only to those who set it', async () => {
        for (const role of [UserRole.HR, UserRole.Finance]) {
          const user = await workspace.addUser({ role });

          expect(await setupLine(user)).toBeUndefined();
        }
      });
    });

    it('opens in a workspace with no projects, with the hours only', async () => {
      const modal = await openSettings();

      expect(fieldIds(modal)).toEqual(['hours']);
      await t.slack
        .submitView(workspace, admin, modal, { hours: '6' })
        .expect(200);
      expect((await settings().get(workspace.id)).minutesPerDay).toBe(360);
    });

    it('starts at 8 hours a day and no projects', async () => {
      expect(await settings().get(workspace.id)).toEqual({
        minutesPerDay: 480,
        projectIds: {},
      });
    });

    it('refuses HR, managers and members, whatever they send', async () => {
      const project = await workspace.addProject({ name: 'Vacations' });
      const adminsForm = await openSettings();

      for (const role of [
        UserRole.HR,
        UserRole.Manager,
        UserRole.Member,
        UserRole.Finance,
      ]) {
        const user = await workspace.addUser({ role });
        const tab = await openAppHomeTab(t, workspace, user, [
          NavigationActionId.Projects,
        ]).catch(() => null);

        if (tab) {
          expect(actionIdsOf(tab)).not.toContain(
            ProjectsTabViewActionId.TimeOffSettings,
          );
        }

        const response = await t.slack
          .submitView(workspace, user, adminsForm, {
            hours: '4',
            annual_leave: project.id,
          })
          .expect(200);

        expect(response.body.view.title.text).toBe('Forbidden');
      }

      expect(await storedRows()).toEqual([]);
      expect((await settings().get(workspace.id)).minutesPerDay).toBe(480);
    });

    it("refuses another workspace's project", async () => {
      const other = await t.createWorkspace();
      const foreign = await other.addProject({ name: 'Foreign' });
      await workspace.addProject({ name: 'Ours' });
      const modal = await openSettings();

      const response = await t.slack
        .submitView(
          workspace,
          admin,
          modal,
          { hours: '8' },
          {
            annual_leave_block: {
              annual_leave: {
                type: 'static_select',
                selected_option: {
                  text: { type: 'plain_text', text: 'Foreign' },
                  value: foreign.id,
                },
              },
            },
          },
        )
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: {
          annual_leave_block:
            'This project is not in this workspace or is archived.',
        },
      });
      expect(await storedRows()).toEqual([]);
    });

    it('answers 0 and 24.5 hours at their field', async () => {
      const modal = await openSettings();

      for (const hours of ['0', '24.5']) {
        const response = await t.slack
          .submitView(workspace, admin, modal, { hours })
          .expect(200);

        expect(response.body).toEqual({
          response_action: 'errors',
          errors: { hours_block: 'Hours must be a number between 0 and 24' },
        });
      }

      expect((await settings().get(workspace.id)).minutesPerDay).toBe(480);
    });
  });
  describe('Logging', () => {
    const logging = () => t.app.get(TimeOffLoggingService);

    const asViewModel = (user: Tables<'users'>) =>
      t.app
        .get(UsersService)
        .findOneWithValidation({ id: user.id, slackTeamId: workspace.id });

    const mapProject = (type: string, projectId: string) =>
      t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: type,
          project_id: projectId,
        })
        .execute();

    const entriesOf = async (user: Tables<'users'>) =>
      (await workspace.rows('time_entries'))
        .filter(({ user_id }) => user_id === user.id)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));

    // Mon 22 Jun is a holiday of the requester's team policy.
    const setup = async (
      { start, end, workingDays } = {
        start: '2026-06-19',
        end: '2026-06-23',
        workingDays: 2,
      },
    ) => {
      const policy = await workspace.addVacationPolicy();
      await t.db
        .insertInto('holidays')
        .values({
          slack_team_id: workspace.id,
          vacation_policy_id: policy.id,
          name: 'Founders Day',
          date: '2026-06-22',
          year: 2026,
          is_company_custom: true,
          created_by: admin.id,
        })
        .execute();
      const team = await workspace.addTeam({ vacation_policy_id: policy.id });
      const requester = await workspace.addUser({ team_id: team.id });
      const project = await workspace.addProject({ name: 'Vacations' });
      await mapProject('annual_leave', project.id);
      const request = await workspace.addVacationRequest(requester, {
        start_date: start,
        end_date: end,
        working_days: workingDays,
      });

      return { team, requester, project, request };
    };

    it('logs one approved entry per working day', async () => {
      const { team, requester, project, request } = await setup();

      const result = await logging().log(
        await asViewModel(requester),
        request.id,
      );
      const entries = await entriesOf(requester);

      expect(result.logged).toEqual(['2026-06-19', '2026-06-23']);
      expect(result.logged).toHaveLength(request.working_days);
      expect(
        entries.map((entry) => [
          entry.work_date.slice(0, 10),
          entry.minutes,
          entry.status,
          entry.project_id,
          entry.team_id,
          entry.created_by,
          entry.vacation_request_id,
          entry.description,
        ]),
      ).toEqual(
        ['2026-06-19', '2026-06-23'].map((date) => [
          date,
          480,
          'approved',
          project.id,
          team.id,
          requester.id,
          request.id,
          'Annual leave',
        ]),
      );
    });

    it('describes the entries by the leave type, so lists say what the hours are', async () => {
      const { requester } = await setup();
      const sick = await workspace.addProject({ name: 'Sick Leave' });
      await mapProject('sick_leave', sick.id);
      const request = await workspace.addVacationRequest(requester, {
        start_date: '2026-06-24',
        end_date: '2026-06-24',
        working_days: 1,
        type: 'sick_leave',
      });

      await logging().log(await asViewModel(requester), request.id);

      expect(
        (await entriesOf(requester)).map(({ project_id, description }) => [
          project_id,
          description,
        ]),
      ).toEqual([[sick.id, 'Sick leave']]);
    });

    it('skips days that already have time on the project', async () => {
      const { requester, project, request } = await setup();
      await workspace.addTimeEntry(requester, project, {
        work_date: '2026-06-19',
        minutes: 480,
      });

      const result = await logging().log(
        await asViewModel(requester),
        request.id,
      );

      expect(result.logged).toEqual(['2026-06-23']);
      expect(await entriesOf(requester)).toHaveLength(2);
    });

    it('logs nothing twice', async () => {
      const { requester, request } = await setup();
      const user = await asViewModel(requester);

      await logging().log(user, request.id);
      const again = await logging().log(user, request.id);

      expect(again.logged).toEqual([]);
      expect(await entriesOf(requester)).toHaveLength(2);
    });

    it('logs one set for two clicks at once', async () => {
      const { requester, request } = await setup({
        start: '2026-06-15',
        end: '2026-06-19',
        workingDays: 5,
      });
      const user = await asViewModel(requester);

      await Promise.all([
        logging().log(user, request.id),
        logging().log(user, request.id),
      ]);

      expect(await entriesOf(requester)).toHaveLength(5);
    });

    it("is only the requester's", async () => {
      const { request } = await setup();
      const other = await workspace.addUser({ role: UserRole.Admin });

      await expect(
        logging().log(await asViewModel(other), request.id),
      ).rejects.toThrow(ForbiddenException);
      expect(await workspace.rows('time_entries')).toEqual([]);
    });

    it('only for approved time off', async () => {
      const { requester, request } = await setup();
      await t.db
        .updateTable('vacation_requests')
        .set({ status: 'pending' })
        .where('id', '=', request.id)
        .execute();

      await expect(
        logging().log(await asViewModel(requester), request.id),
      ).rejects.toThrow('This time off is no longer approved.');
      expect(await workspace.rows('time_entries')).toEqual([]);
    });

    it('has no offer without a project for the type, or for "Other"', async () => {
      const { requester, request, project } = await setup();
      const model = (id: string) =>
        t.app
          .get(VacationRequestsService)
          .findOneWithValidation({ id, slackTeamId: workspace.id });
      const sick = await workspace.addVacationRequest(requester, {
        start_date: '2026-06-19',
        end_date: '2026-06-19',
        type: 'sick_leave',
      });
      const other = await workspace.addVacationRequest(requester, {
        start_date: '2026-06-19',
        end_date: '2026-06-19',
        type: 'other',
      });

      expect(await logging().offerFor(await model(sick.id))).toBeNull();
      expect(await logging().offerFor(await model(other.id))).toBeNull();
      expect(await logging().offerFor(await model(request.id))).toEqual({
        requestId: request.id,
        projectId: project.id,
        projectName: 'Vacations',
        minutes: 480,
        dates: ['2026-06-19', '2026-06-23'],
      });

      await t.db
        .updateTable('projects')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', project.id)
        .execute();

      expect(await logging().offerFor(await model(request.id))).toBeNull();
    });
  });

  describe('The offer', () => {
    const OFFER = 'log_time_off';

    let manager: Tables<'users'>;
    let requester: Tables<'users'>;

    beforeEach(async () => {
      manager = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Mary Manager',
      });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      requester = await workspace.addUser({
        team_id: team.id,
        name: 'Max Member',
      });
    });

    const mapProject = async (name: string, type = 'annual_leave') => {
      const project = await workspace.addProject({ name });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: type,
          project_id: project.id,
        })
        .execute();

      return project;
    };

    const messagesTo = (user: Tables<'users'>) =>
      t.slackApi.postedMessages(workspace.token, user.slack_id);

    const offersTo = (user: Tables<'users'>) =>
      messagesTo(user).filter((message) =>
        buttonText(message as unknown as View, OFFER),
      );

    const entriesOf = async (user: Tables<'users'>) =>
      (await workspace.rows('time_entries'))
        .filter(({ user_id }) => user_id === user.id)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));

    // The requester asks, the manager approves.
    const approvedThroughWorkflow = async (
      type = VacationType.AnnualLeave,
      weeksAhead = 2,
    ) => {
      await requestVacation(t, workspace, requester, {
        ...workWeek(weeksAhead),
        type,
      });
      await t.slack
        .actOnMessage(
          workspace,
          manager,
          await approvalMessageTo(t, workspace, manager),
          ApproverMessageActionId.Approve,
        )
        .expect(200);
      await t.idle();
    };

    it('offers the button in the approved DM and logs on click', async () => {
      const project = await mapProject('Vacations Paid');
      await approvedThroughWorkflow();

      // One message, the decision DM, holds the button.
      const offers = offersTo(requester);
      expect(offers).toHaveLength(1);
      expect(textOf(offers[0])).toContain('Your time off request was approved');
      expect(buttonText(offers[0] as unknown as View, OFFER)).toBe(
        'Log 40h to Vacations Paid',
      );

      await t.slack
        .actOnMessage(workspace, requester, offers[0], OFFER)
        .expect(200);
      await t.idle();

      const entries = await entriesOf(requester);
      expect(entries).toHaveLength(5);
      expect(entries.map(({ project_id }) => project_id)).toEqual(
        Array(5).fill(project.id),
      );

      const [update] = t.slackApi.messageUpdates(workspace.token, offers[0]);
      expect(textOf(update)).toContain('✅ 40h logged to Vacations Paid.');
      expect(textOf(update)).toContain('Your time off request was approved');
      expect(JSON.stringify(update.blocks)).not.toContain(OFFER);
    });

    it('lists the days it skipped', async () => {
      const project = await mapProject('Vacations Paid');
      const { start } = workWeek(2);
      await workspace.addTimeEntry(requester, project, {
        work_date: start,
        minutes: 60,
      });
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(await entriesOf(requester)).toHaveLength(5);
      const [update] = t.slackApi.messageUpdates(workspace.token, offer);
      expect(textOf(update)).toContain('✅ 32h logged to Vacations Paid.');
      expect(textOf(update)).toContain(
        `Skipped, already have time on Vacations Paid: ${formatDateList([start])}.`,
      );
    });

    it('offers it for time off HR approves directly', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      await mapProject('Vacations Paid');
      const requestsTab = await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]);
      const form = await openModalFrom(
        t,
        workspace,
        hr,
        requestsTab,
        VacationRequestsTabViewActionId.CreateRequest,
      );
      const { start, end } = workWeek(2);

      await t.slack
        .submitView(workspace, hr, form, {
          [VacationRequestsTabViewActionId.UserField]: requester.id,
          status: VacationRequestStatus.Approved,
          start_date: start,
          end_date: end,
          type_option: VacationType.AnnualLeave,
        })
        .expect(200);
      await t.idle();

      const offers = offersTo(requester);
      expect(offers).toHaveLength(1);
      expect(buttonText(offers[0] as unknown as View, OFFER)).toBe(
        'Log 40h to Vacations Paid',
      );
      expect(offers[0].to).toBe(requester.slack_id);
    });

    it('has no button without a project for the type, or when that project is archived', async () => {
      await approvedThroughWorkflow(VacationType.SickLeave);

      expect(messagesTo(requester).length).toBeGreaterThan(0);
      expect(offersTo(requester)).toEqual([]);

      const project = await mapProject('Vacations Paid');
      await t.db
        .updateTable('projects')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', project.id)
        .execute();
      await approvedThroughWorkflow(VacationType.AnnualLeave, 3);

      expect(offersTo(requester)).toEqual([]);
    });

    it("refuses someone else's click", async () => {
      await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);

      for (const other of [
        await workspace.addUser({ name: 'Eve Member' }),
        manager,
      ]) {
        await t.slack.actOnMessage(workspace, other, offer, OFFER).expect(200);
        await t.idle();
      }

      expect(await workspace.rows('time_entries')).toEqual([]);
      expect(t.slackApi.messageUpdates(workspace.token, offer)).toEqual([]);
    });

    it('answers a click on time off that is no longer approved', async () => {
      await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);
      await t.db
        .updateTable('vacation_requests')
        .set({ status: 'canceled' })
        .where('slack_team_id', '=', workspace.id)
        .execute();

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(await workspace.rows('time_entries')).toEqual([]);
      expect(
        t.slackApi
          .ephemeralMessages(workspace.token, requester.slack_id)
          .map(({ text }) => text),
      ).toEqual(['This time off is no longer approved.']);
    });

    it('keeps a true message when the button is clicked twice at once', async () => {
      await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);

      await Promise.all([
        t.slack.actOnMessage(workspace, requester, offer, OFFER).expect(200),
        t.slack.actOnMessage(workspace, requester, offer, OFFER).expect(200),
      ]);
      await t.idle();

      expect(await entriesOf(requester)).toHaveLength(5);
      const updates = t.slackApi.messageUpdates(workspace.token, offer);
      expect(updates).toHaveLength(2);
      expect(updates.map((update) => textOf(update))).toEqual([
        expect.stringContaining('✅ 40h logged to Vacations Paid.'),
        expect.stringContaining('✅ 40h logged to Vacations Paid.'),
      ]);
      expect(JSON.stringify(updates)).not.toContain('Skipped');
    });

    it('logs nothing and says so when every day has hand-logged time', async () => {
      const project = await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);
      const { start } = workWeek(2);

      for (let day = 0; day < 5; day++) {
        await workspace.addTimeEntry(requester, project, {
          work_date: addDays(start, day),
          minutes: 120,
        });
      }

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(await entriesOf(requester)).toHaveLength(5);
      const [update] = t.slackApi.messageUpdates(workspace.token, offer);
      expect(textOf(update)).toContain(
        'Nothing was logged: those days already have time on Vacations Paid.',
      );
      expect(textOf(update)).not.toContain('logged to');
      expect(textOf(update)).not.toContain('40h');
    });

    it('tells the requester when an unexpected error stops it', async () => {
      await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);
      t.slackApi.failNext('chat.update', 1, 'service_unavailable');

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(
        t.slackApi
          .ephemeralMessages(workspace.token, requester.slack_id)
          .map(({ text }) => text),
      ).toEqual(["Couldn't log your time off, please try again."]);
    });

    it('tells the requester when the project was archived after the DM', async () => {
      const project = await mapProject('Vacations Paid');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);
      await t.db
        .updateTable('projects')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', project.id)
        .execute();

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(await workspace.rows('time_entries')).toEqual([]);
      expect(t.slackApi.messageUpdates(workspace.token, offer)).toEqual([]);
      expect(
        t.slackApi
          .ephemeralMessages(workspace.token, requester.slack_id)
          .map(({ text }) => text),
      ).toEqual(['This time off has no project to log on.']);
    });

    it('escapes the project name', async () => {
      // The display rules refuse '<!here>' even in a plain_text label, where
      // it is harmless, so the name has other markup.
      await mapProject('R&D <b>PTO</b>');
      await approvedThroughWorkflow();
      const [offer] = offersTo(requester);

      expect(buttonText(offer as unknown as View, OFFER)).toBe(
        'Log 40h to R&D <b>PTO</b>',
      );

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      const [update] = t.slackApi.messageUpdates(workspace.token, offer);
      expect(textOf(update)).toContain(
        '✅ 40h logged to R&amp;D &lt;b&gt;PTO&lt;/b&gt;.',
      );
      expect(textOf(update)).not.toContain('<b>');
    });
  });

  // HR or an admin changes a vacation whose time was logged.
  describe('Changes after logging', () => {
    const OFFER = 'log_time_off';
    // This week (today is Wed 17 Jun) and the next one.
    const THIS_WEEK = { start: '2026-06-15', end: '2026-06-19' };
    const NEXT_WEEK = { start: '2026-06-22', end: '2026-06-26' };

    let hr: Tables<'users'>;
    let requester: Tables<'users'>;
    let client: Tables<'clients'>;
    let vacations: Tables<'projects'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
      requester = await workspace.addUser({
        name: 'Max Member',
        email: 'max@example.test',
      });
      client = await workspace.addClient({ name: 'Internal' });
      vacations = await mapProject('Vacations', 'annual_leave');
    });

    const mapProject = async (name: string, type: string) => {
      const project = await workspace.addProject({
        name,
        client_id: client.id,
      });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: type,
          project_id: project.id,
        })
        .execute();

      return project;
    };

    // An approved annual leave of the requester, logged as time.
    const loggedVacation = async (week = THIS_WEEK) => {
      const request = await workspace.addVacationRequest(requester, {
        start_date: week.start,
        end_date: week.end,
        days: 5,
        working_days: 5,
      });
      const user = await t.app
        .get(UsersService)
        .findOneWithValidation({ id: requester.id, slackTeamId: workspace.id });
      await t.app.get(TimeOffLoggingService).log(user, request.id);
      expect(await liveEntries()).toHaveLength(5);

      return request;
    };

    const liveEntries = async () =>
      (await workspace.rows('time_entries'))
        .filter(({ deleted_at }) => deleted_at === null)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));

    const offersTo = (user: Tables<'users'>) =>
      t.slackApi
        .postedMessages(workspace.token, user.slack_id)
        .filter((message) => buttonText(message as unknown as View, OFFER));

    // The DMs the requester got after the mark `since`: their sections, and
    // the offer's button if it has one.
    const dmsSince = (since: number) =>
      t.slackApi
        .postedMessages(workspace.token, requester.slack_id, { since })
        .map((message) => ({
          sections: sectionTexts(message as unknown as View),
          button: buttonText(message as unknown as View, OFFER),
        }));

    const THIS_WEEK_TEXT = `annual leave ${formatDateRange(THIS_WEEK.start, THIS_WEEK.end)}`;
    const NEXT_WEEK_TEXT = `annual leave ${formatDateRange(NEXT_WEEK.start, NEXT_WEEK.end)}`;
    const offerSection = (
      week: { start: string; end: string },
      project = 'Vacations',
      type = 'Annual leave',
    ) =>
      `*${type}* · ${formatDateRange(week.start, week.end)}\nLog it as time on *${project}*?`;

    const requestsTab = (user: Tables<'users'>) =>
      openAppHomeTab(t, workspace, user, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]);

    // Submits `form` and returns the notice of the tab it goes back to, or
    // the form's answer when it stays open.
    const submitForNotice = async (
      user: Tables<'users'>,
      form: View,
      values: Record<string, string> = {},
    ) => {
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, user, form, values)
        .expect(200);
      const notice =
        response.body.response_action === 'clear'
          ? noticeOf(await publishedHome(t, workspace, user, since))
          : JSON.stringify(response.body);
      await t.idle();

      return notice;
    };

    // HR's Edit Request form, with `values` changed.
    const editAsHr = async (
      request: Tables<'vacation_requests'>,
      values: Record<string, string>,
    ) =>
      submitForNotice(
        hr,
        await openModalFrom(
          t,
          workspace,
          hr,
          await requestsTab(hr),
          VacationRequestsTabViewActionId.ManageRequestMenu,
          `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
        ),
        values,
      );

    // The admin's Delete Request confirmation, confirmed.
    const deleteAsAdmin = async (request: Tables<'vacation_requests'>) =>
      submitForNotice(
        admin,
        await openModalFrom(
          t,
          workspace,
          admin,
          await requestsTab(admin),
          VacationRequestsTabViewActionId.ManageRequestMenu,
          `${VacationRequestsTabViewActionId.DeleteRequest}:${request.id}`,
        ),
      );

    const lockInSnapshot = async (entries: Tables<'time_entries'>[]) => {
      const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
      const snapshot = await t.db
        .insertInto('billing_snapshots')
        .values({
          slack_team_id: workspace.id,
          client_id: client.id,
          period_start: THIS_WEEK.start,
          period_end: THIS_WEEK.end,
          currency: 'USD',
          total_minutes: minutes,
          billable_minutes: minutes,
          total_amount: 0,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await t.db
        .insertInto('billing_snapshot_entries')
        .values(
          entries.map((entry) => ({
            slack_team_id: workspace.id,
            snapshot_id: snapshot.id,
            time_entry_id: entry.id,
            minutes: entry.minutes,
            billable: entry.billable,
          })),
        )
        .execute();
    };

    it('removes the logged time when HR changes the dates, and offers again', async () => {
      const request = await loggedVacation();
      const since = t.slackApi.mark();

      expect(
        await editAsHr(request, {
          start_date: NEXT_WEEK.start,
          end_date: NEXT_WEEK.end,
        }),
      ).toBe('✅ Vacation request updated.');

      expect(await liveEntries()).toEqual([]);
      expect(
        (await workspace.rows('time_entries')).map(
          ({ deleted_by, vacation_request_id }) => [
            deleted_by,
            vacation_request_id,
          ],
        ),
      ).toEqual(Array(5).fill([hr.id, request.id]));

      const offers = offersTo(requester);
      expect(offers).toHaveLength(1);
      expect(textOf(offers[0])).toContain(
        formatDateRange(NEXT_WEEK.start, NEXT_WEEK.end),
      );
      expect(buttonText(offers[0] as unknown as View, OFFER)).toBe(
        'Log 40h to Vacations',
      );
      // One DM: what went, then the offer for the new days.
      expect(dmsSince(since)).toEqual([
        {
          sections: [
            `Your ${THIS_WEEK_TEXT} changed: the 40h logged on Vacations were removed.`,
            offerSection(NEXT_WEEK),
          ],
          button: 'Log 40h to Vacations',
        },
      ]);
    });

    it('removes it when HR rejects or deletes the vacation, without a new offer', async () => {
      const rejected = await loggedVacation(THIS_WEEK);
      let since = t.slackApi.mark();

      expect(
        await editAsHr(rejected, { status: VacationRequestStatus.Rejected }),
      ).toBe('✅ Vacation request updated.');
      expect(await liveEntries()).toEqual([]);
      expect(dmsSince(since)).toEqual([
        {
          sections: [
            `Your ${THIS_WEEK_TEXT} was rejected: the 40h logged on Vacations were removed.`,
          ],
          button: undefined,
        },
      ]);

      const deleted = await loggedVacation(NEXT_WEEK);
      since = t.slackApi.mark();

      expect(await deleteAsAdmin(deleted)).toBe('✅ Vacation request deleted.');
      expect(await liveEntries()).toEqual([]);
      expect(
        (await workspace.rows('vacation_requests')).map(({ id }) => id),
      ).toEqual([rejected.id]);
      expect(offersTo(requester)).toEqual([]);
      expect(dmsSince(since)).toEqual([
        {
          sections: [
            `Your ${NEXT_WEEK_TEXT} was deleted: the 40h logged on Vacations were removed.`,
          ],
          button: undefined,
        },
      ]);
    });

    it('offers again without a removal line when nothing was logged', async () => {
      const request = await workspace.addVacationRequest(requester, {
        start_date: THIS_WEEK.start,
        end_date: THIS_WEEK.end,
        days: 5,
        working_days: 5,
      });
      const since = t.slackApi.mark();

      await editAsHr(request, {
        start_date: NEXT_WEEK.start,
        end_date: NEXT_WEEK.end,
      });

      expect(dmsSince(since)).toEqual([
        {
          sections: [offerSection(NEXT_WEEK)],
          button: 'Log 40h to Vacations',
        },
      ]);
    });

    it('tells the person whose time went, and offers it to the new one', async () => {
      const request = await loggedVacation();
      const other = await workspace.addUser({ name: 'Olga Other' });
      const since = t.slackApi.mark();

      await editAsHr(request, {
        [VacationRequestsTabViewActionId.UserField]: other.id,
      });

      expect(dmsSince(since)).toEqual([
        {
          sections: [
            `Your ${THIS_WEEK_TEXT} was moved to someone else: the 40h logged on Vacations were removed.`,
          ],
          button: undefined,
        },
      ]);
      expect(
        t.slackApi
          .postedMessages(workspace.token, other.slack_id, { since })
          .map((message) => buttonText(message as unknown as View, OFFER)),
      ).toEqual(['Log 40h to Vacations']);
    });

    it('keeps billed days and says so', async () => {
      const request = await loggedVacation();
      const billed = (await liveEntries()).filter(({ work_date }) =>
        ['2026-06-17', '2026-06-18'].includes(work_date.slice(0, 10)),
      );
      await lockInSnapshot(billed);
      let since = t.slackApi.mark();

      expect(
        await editAsHr(request, {
          start_date: NEXT_WEEK.start,
          end_date: NEXT_WEEK.end,
        }),
      ).toBe(
        '✅ Vacation request updated. 2 days stay logged: they are billed (17–18 Jun).',
      );

      expect(
        (await liveEntries()).map(({ id, vacation_request_id }) => [
          id,
          vacation_request_id,
        ]),
      ).toEqual(billed.map(({ id }) => [id, request.id]));
      expect(offersTo(requester)).toHaveLength(1);
      expect(dmsSince(since).map(({ sections }) => sections[0])).toEqual([
        `Your ${THIS_WEEK_TEXT} changed: the 24h logged on Vacations were removed. 2 days stay logged: they are billed (17–18 Jun).`,
      ]);
      since = t.slackApi.mark();

      // Deleting the vacation keeps them too, without the link.
      expect(await deleteAsAdmin(request)).toBe(
        '✅ Vacation request deleted. 2 days stay logged: they are billed (17–18 Jun).',
      );
      expect(
        (await liveEntries()).map(({ id, vacation_request_id }) => [
          id,
          vacation_request_id,
        ]),
      ).toEqual(billed.map(({ id }) => [id, null]));
      // Nothing more went: nothing to tell.
      expect(dmsSince(since)).toEqual([]);
    });

    it('does nothing for edits that change neither dates nor status', async () => {
      const request = await loggedVacation();
      const before = await liveEntries();

      expect(await editAsHr(request, { comment: 'Family trip' })).toBe(
        '✅ Vacation request updated.',
      );

      expect(await liveEntries()).toEqual(before);
      expect(offersTo(requester)).toEqual([]);
    });

    // The project depends on the type: logging it again after a type change
    // would leave two sets of entries on two projects.
    it("removes it when HR changes the type, and offers the new type's project", async () => {
      await mapProject('Sick Leave', 'sick_leave');
      const request = await loggedVacation();

      expect(
        await editAsHr(request, { type_option: VacationType.SickLeave }),
      ).toBe('✅ Vacation request updated.');

      expect(await liveEntries()).toEqual([]);
      const offers = offersTo(requester);
      expect(offers).toHaveLength(1);
      expect(buttonText(offers[0] as unknown as View, OFFER)).toBe(
        'Log 40h to Sick Leave',
      );
    });

    it('logs the new type only on days without billed time of the old one', async () => {
      const sick = await mapProject('Sick Leave', 'sick_leave');
      const request = await loggedVacation();
      const billed = (await liveEntries()).filter(({ work_date }) =>
        ['2026-06-17', '2026-06-18'].includes(work_date.slice(0, 10)),
      );
      await lockInSnapshot(billed);
      await editAsHr(request, { type_option: VacationType.SickLeave });
      const [offer] = offersTo(requester);

      await t.slack
        .actOnMessage(workspace, requester, offer, OFFER)
        .expect(200);
      await t.idle();

      expect(
        (await liveEntries()).map(
          ({ work_date, project_id, vacation_request_id }) => [
            work_date.slice(0, 10),
            project_id === vacations.id ? 'Vacations' : project_id,
            vacation_request_id,
          ],
        ),
      ).toEqual([
        ['2026-06-15', sick.id, request.id],
        ['2026-06-16', sick.id, request.id],
        ['2026-06-17', 'Vacations', request.id],
        ['2026-06-18', 'Vacations', request.id],
        ['2026-06-19', sick.id, request.id],
      ]);
      const [update] = t.slackApi.messageUpdates(workspace.token, offer);
      expect(textOf(update)).toContain(
        '✅ 24h logged to Sick Leave.\\nAlready logged for this time off on Vacations: 17–18 Jun.',
      );
      expect(textOf(update)).not.toContain('Skipped');
    });
  });
});
