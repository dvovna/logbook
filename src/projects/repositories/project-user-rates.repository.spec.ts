import { recordingDatabase } from 'src/database/testing/recording-database';
import { ProjectUserRatesRepository } from 'src/projects/repositories/project-user-rates.repository';

describe('ProjectUserRatesRepository', () => {
  it("upserts the rate, keeping who set it first and another workspace's row", async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase();

    await new ProjectUserRatesRepository(database).setRate({
      slackTeamId: 'team-1',
      projectId: 'project-1',
      userId: 'user-1',
      hourlyRate: 150,
      updatedBy: 'admin-1',
    });

    expect(sqlOf(0)).toBe(
      'insert into "project_user_rates" ("slack_team_id", "project_id", "user_id", "hourly_rate", "created_by", "updated_by", "created_at", "updated_at") ' +
        'values ($1, $2, $3, $4, $5, $6, $7, $8) ' +
        'on conflict ("project_id", "user_id") do update set "hourly_rate" = $9, "updated_by" = $10, "updated_at" = $11 ' +
        'where "project_user_rates"."slack_team_id" = $12',
    );
    expect(parametersOf(0)).toEqual([
      'team-1',
      'project-1',
      'user-1',
      150,
      'admin-1',
      'admin-1',
      expect.any(String),
      expect.any(String),
      150,
      'admin-1',
      expect.any(String),
      'team-1',
    ]);
  });
});
