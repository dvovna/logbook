import { noticeOf } from './support/tab-readers';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

describe('Admin', () => {
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

  describe('deleting a team', () => {
    // Home → People → Teams → the team's menu → Delete: the confirmation modal.
    const openDeleteConfirmation = async (team: Tables<'teams'>) => {
      const teamsTab = await openAppHomeTab(t, workspace, admin, [
        NavigationActionId.Teams,
      ]);

      return openModalFrom(
        t,
        workspace,
        admin,
        teamsTab,
        TeamsTabViewActionId.ManageTeamMenu,
        `${TeamsTabViewActionId.DeleteTeam}:${team.id}`,
      );
    };

    it('refuses while the team has active members', async () => {
      const team = await workspace.addTeam({ name: 'Design' });
      await workspace.addUser({ team_id: team.id });

      const confirmation = await openDeleteConfirmation(team);
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain('1 active member');
      expect(await workspace.rows('teams')).toHaveLength(1);
    });

    it('deletes a team whose members are all inactive', async () => {
      const team = await workspace.addTeam({ name: 'Design' });
      await workspace.addUser({ team_id: team.id, is_active: false });

      const confirmation = await openDeleteConfirmation(team);
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Team Design deleted.',
      );
      expect(await workspace.rows('teams')).toEqual([]);
    });
  });

  describe('a shared file', () => {
    it('logs, rather than crashes on, a file it cannot download', async () => {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown) => rejections.push(reason);
      process.on('unhandledRejection', onRejection);

      try {
        await t.slack
          .event(workspace, {
            type: 'file_shared',
            file_id: 'F_DELETED',
            user_id: admin.slack_id,
            channel_id: 'D_TEST',
          })
          .expect(acknowledged);

        await t.idle();
        expect(
          t.slackApi.callsWith(workspace.token, 'files.info'),
        ).toHaveLength(1);
        // Node reports an unhandled rejection on a later turn of the loop.
        await new Promise((resolve) => setImmediate(resolve));
        expect(rejections).toEqual([]);
      } finally {
        process.off('unhandledRejection', onRejection);
      }
    });
  });
});
