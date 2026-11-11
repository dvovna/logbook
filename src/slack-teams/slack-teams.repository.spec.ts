import { recordingDatabase } from 'src/database/testing/recording-database';
import { SlackTeamsRepository } from 'src/slack-teams/slack-teams.repository';

const TOKENS = {
  slack_token: 'v1:new-token',
  slack_refresh_token: 'v1:new-refresh',
  slack_token_expires_at: '2026-06-17T21:00:00.000Z',
};

describe('SlackTeamsRepository', () => {
  describe('replaceTokens', () => {
    it('saves the pair only over the refresh token it read', async () => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [{ id: 'workspace-1' }],
      ]);

      await expect(
        new SlackTeamsRepository(database).replaceTokens(
          'workspace-1',
          'v1:old-refresh',
          TOKENS,
        ),
      ).resolves.toBe(true);

      expect(sqlOf(0)).toBe(
        'update "slack_teams" set "slack_token" = $1, "slack_refresh_token" = $2, "slack_token_expires_at" = $3 ' +
          'where "id" = $4 and "slack_refresh_token" = $5 returning "id"',
      );
      expect(parametersOf(0)).toEqual([
        'v1:new-token',
        'v1:new-refresh',
        '2026-06-17T21:00:00.000Z',
        'workspace-1',
        'v1:old-refresh',
      ]);
    });

    it('says so when another write came first', async () => {
      const { database } = recordingDatabase([[]]);

      await expect(
        new SlackTeamsRepository(database).replaceTokens(
          'workspace-1',
          'v1:old-refresh',
          TOKENS,
        ),
      ).resolves.toBe(false);
    });
  });

  describe('claimMemberSync', () => {
    it("claims an installed workspace's import when none started since", async () => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [{ id: 'workspace-1' }],
      ]);

      await expect(
        new SlackTeamsRepository(database).claimMemberSync(
          'workspace-1',
          new Date('2026-06-16T09:00:00.000Z'),
          new Date('2026-06-17T09:00:00.000Z'),
        ),
      ).resolves.toBe(true);

      expect(sqlOf(0)).toBe(
        'update "slack_teams" set "members_synced_at" = $1 ' +
          'where "id" = $2 and "uninstalled_at" is null ' +
          'and ("members_synced_at" is null or "members_synced_at" <= $3) returning "id"',
      );
      expect(parametersOf(0)).toEqual([
        '2026-06-17T09:00:00.000Z',
        'workspace-1',
        '2026-06-16T09:00:00.000Z',
      ]);
    });

    it('leaves it to the process that claimed it', async () => {
      const { database } = recordingDatabase([[]]);

      await expect(
        new SlackTeamsRepository(database).claimMemberSync(
          'workspace-1',
          new Date('2026-06-16T09:00:00.000Z'),
          new Date('2026-06-17T09:00:00.000Z'),
        ),
      ).resolves.toBe(false);
    });
  });
});
