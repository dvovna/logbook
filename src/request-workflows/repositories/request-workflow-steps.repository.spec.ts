import { RequestWorkflowStepsRepository } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { recordingDatabase } from 'src/database/testing/recording-database';

describe('RequestWorkflowStepsRepository', () => {
  it('skips one open step, saying until when its approver is away', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([[]]);

    await expect(
      new RequestWorkflowStepsRepository(database).skip({
        slackTeamId: 'team-1',
        requestId: 'request-1',
        stepId: 'step-1',
        awayUntil: '2026-06-24',
      }),
    ).resolves.toBeNull();

    expect(sqlOf(0)).toContain('update "request_workflow_steps"');
    expect(sqlOf(0)).toContain('"completed_at" is null');
    expect(sqlOf(0)).toContain("'decided_by_slack_id', null");
    expect(parametersOf(0)).toEqual(
      expect.arrayContaining([
        'skipped',
        'time_off',
        '2026-06-24',
        'team-1',
        'request-1',
        'step-1',
      ]),
    );
  });
});
