import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { actionIdsOf, noticeOf } from './support/tab-readers';
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
});
