import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { TeamsTabViewActionId } from '@modules/slack/tabs/teams/enums/teams-tab-view-actions-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import { openAppHomeTab, openModalFrom } from './support/app-home';

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
        AdminNavigationActionId.ManagePeople,
        AdminNavigationActionId.ManageTeams,
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
      const response = await t.slack
        .submitView(workspace, admin, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        "Team 'Design' has been successfully deleted",
      );
      expect(await workspace.rows('teams')).toEqual([]);
    });
  });

  describe('user-team-mapping.csv', () => {
    const shareFile = (user: Tables<'users'>, name: string, content: string) =>
      t.slack
        .event(workspace, {
          type: 'file_shared',
          file_id: t.slackApi.addFile(name, content),
          user_id: user.slack_id,
          channel_id: 'D_TEST',
        })
        .expect(acknowledged);

    it('moves users to the teams named in the file', async () => {
      const design = await workspace.addTeam({ name: 'Design' });
      const ada = await workspace.addUser({ email: 'ada@example.test' });
      const bob = await workspace.addUser({ email: 'bob@example.test' });

      await shareFile(
        admin,
        'user-team-mapping.csv',
        `email;team_name\n${ada.email};Design\n`,
      );

      await t.idle();
      expect((await workspace.row('users', ada.id)).team_id).toBe(design.id);
      expect((await workspace.row('users', bob.id)).team_id).toBeNull();
      expect(
        t.slackApi.ephemeralMessages(workspace.token, admin.slack_id),
      ).toHaveLength(1);
    });

    it('reports rows it cannot import', async () => {
      const ada = await workspace.addUser({ email: 'ada@example.test' });

      await shareFile(
        admin,
        'user-team-mapping.csv',
        `email;team_name\n${ada.email};Nonexistent\n`,
      );

      await t.idle();
      const [reply] = t.slackApi.ephemeralMessages(
        workspace.token,
        admin.slack_id,
      );
      expect(textOf(reply)).toContain(
        '`user-team-mapping.csv` was not imported',
      );
      expect(textOf(reply)).toContain('Team not found: Nonexistent');
    });

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

    it('ignores files shared by non-admins', async () => {
      const member = await workspace.addUser();
      const design = await workspace.addTeam({ name: 'Design' });

      await shareFile(
        member,
        'user-team-mapping.csv',
        `email;team_name\n${member.email};Design\n`,
      );

      await t.idle();
      expect((await workspace.row('users', member.id)).team_id).toBeNull();
      expect(design).toBeDefined();
      expect(t.slackApi.callsWith(workspace.token, 'files.info')).toEqual([]);
    });
  });
});
