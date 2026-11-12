import { recordingDatabase } from 'src/database/testing/recording-database';
import { UsersRepository } from '@modules/users/repositories/users.repository';

const row = (id: string, teamId: string | null) => ({
  id,
  email: `${id}@x.test`,
  name: id,
  is_active: true,
  carryover_days: 0,
  role: 'member',
  contract_start_date: null,
  slack_id: `U${id}`,
  slack_team_id: 'workspace-1',
  team_id: teamId,
  created_at: '2026-11-12T10:00:00.000000+00:00',
  updated_at: null,
  updated_by: 'hr-1',
});

describe('UsersRepository', () => {
  describe('assignTeams', () => {
    it("checks the teams are the workspace's, then moves the users of each team in one statement and returns those that moved", async () => {
      const { database, queries, sqlOf, parametersOf } = recordingDatabase([
        [{ id: 'acme' }],
        [row('ann', 'acme')],
        [row('bo', null)],
      ]);

      const moved = await new UsersRepository(database).assignTeams({
        slackTeamId: 'workspace-1',
        assignments: [
          { userId: 'ann', teamId: 'acme' },
          { userId: 'bo', teamId: null },
          { userId: 'cy', teamId: 'acme' },
        ],
        updatedBy: 'hr-1',
      });

      expect(moved.map(({ id, team_id }) => [id, team_id])).toEqual([
        ['ann', 'acme'],
        ['bo', null],
      ]);
      expect(queries).toHaveLength(3);
      expect(sqlOf(0)).toContain('from "teams"');
      expect(parametersOf(0)).toEqual(['workspace-1', 'acme']);
      for (const index of [1, 2]) {
        expect(sqlOf(index)).toContain('update "users"');
        expect(sqlOf(index)).toContain('"slack_team_id" = $');
        expect(sqlOf(index)).toContain('"team_id" is distinct from $');
      }
      expect(parametersOf(1)).toEqual(
        expect.arrayContaining(['acme', 'workspace-1', 'ann', 'cy']),
      );
      expect(parametersOf(2)).toEqual(
        expect.arrayContaining([null, 'workspace-1', 'bo']),
      );
    });

    it('refuses a team of another workspace and moves nobody', async () => {
      const { database, queries } = recordingDatabase([[]]);

      await expect(
        new UsersRepository(database).assignTeams({
          slackTeamId: 'workspace-1',
          assignments: [{ userId: 'ann', teamId: 'foreign' }],
          updatedBy: 'hr-1',
        }),
      ).rejects.toThrow('not in workspace workspace-1');
      expect(queries).toHaveLength(1);
    });

    it('asks nothing about teams when everyone leaves theirs', async () => {
      const { database, queries, sqlOf } = recordingDatabase([
        [row('bo', null)],
      ]);

      await new UsersRepository(database).assignTeams({
        slackTeamId: 'workspace-1',
        assignments: [{ userId: 'bo', teamId: null }],
        updatedBy: 'hr-1',
      });

      expect(queries).toHaveLength(1);
      expect(sqlOf(0)).toContain('update "users"');
    });
  });

  describe('setTeamMembers', () => {
    it('returns the users who left the team and those who joined it, not those already in it', async () => {
      const { database, sqlOf } = recordingDatabase([
        [{ id: 'acme' }],
        [row('ann', null)],
        [row('bo', 'acme')],
      ]);

      const changed = await new UsersRepository(database).setTeamMembers({
        slackTeamId: 'workspace-1',
        teamId: 'acme',
        userIds: ['bo', 'cy'],
        updatedBy: 'hr-1',
      });

      expect(changed.map(({ id, team_id }) => [id, team_id])).toEqual([
        ['ann', null],
        ['bo', 'acme'],
      ]);
      expect(sqlOf(2)).toContain('"team_id" is distinct from $');
    });

    it('takes out only the active members who are not chosen', async () => {
      const { database, sqlOf } = recordingDatabase([[{ id: 'acme' }], []]);

      await new UsersRepository(database).setTeamMembers({
        slackTeamId: 'workspace-1',
        teamId: 'acme',
        userIds: [],
        updatedBy: 'hr-1',
      });

      expect(sqlOf(1)).toContain('"is_active" = $');
    });
  });

  // A leave file sets everyone's contract start at once.
  it("sets each user's contract start in one statement of the workspace", async () => {
    const { database, queries, sqlOf, parametersOf } = recordingDatabase();
    const dates = {
      ann: '2025-09-01T00:00:00.000Z',
      bo: '2024-01-15T00:00:00.000Z',
    };

    await new UsersRepository(database).setContractStartDates({
      slackTeamId: 'workspace-1',
      dates,
      updatedBy: 'admin-1',
    });

    expect(queries).toHaveLength(1);
    expect(sqlOf(0)).toMatch(
      /^update "users" set "contract_start_date" = \(\$1::jsonb ->> users\.id::text\)::date, "updated_at" = \$2, "updated_by" = \$3 where "slack_team_id" = \$4 and "id" = any\(\$5\)$/,
    );
    expect(parametersOf(0)).toEqual([
      JSON.stringify(dates),
      expect.any(String),
      'admin-1',
      'workspace-1',
      ['ann', 'bo'],
    ]);
  });
});
