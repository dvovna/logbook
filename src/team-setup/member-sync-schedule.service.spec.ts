import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { JobsService } from '@common/jobs/jobs.service';
import { SYNC_USERS_JOB } from '@modules/team-setup/team-setup-workflow.service';

describe('MemberSyncScheduleService', () => {
  it('imports the members of each installed workspace, one after another', async () => {
    const order: string[] = [];
    const jobs = {
      run: jest.fn(async (_name: string, { slackTeamId }) => {
        order.push(`start ${slackTeamId}`);
        await Promise.resolve();
        order.push(`end ${slackTeamId}`);
      }),
    };
    const service = new MemberSyncScheduleService(
      {
        findInstalledIds: jest.fn().mockResolvedValue(['ws-1', 'ws-2']),
      } as unknown as SlackTeamsService,
      jobs as unknown as JobsService,
    );

    expect(await service.syncAll()).toBe(2);

    expect(jobs.run).toHaveBeenCalledWith(SYNC_USERS_JOB, {
      slackTeamId: 'ws-1',
      scheduled: true,
      askAboutNew: true,
    });
    expect(order).toEqual(['start ws-1', 'end ws-1', 'start ws-2', 'end ws-2']);
  });
});

describe('MemberSyncScheduleService.syncDue', () => {
  it('imports only the workspaces it claimed, a day after their last import', async () => {
    const now = new Date('2026-06-17T09:00:00.000Z');
    const slackTeamsService = {
      findInstalledIds: jest.fn().mockResolvedValue(['ws-1', 'ws-2', 'ws-3']),
      // ws-2 was claimed by another process.
      claimMemberSync: jest.fn(async (id: string) => id !== 'ws-2'),
    };
    const jobs = { run: jest.fn().mockResolvedValue(undefined) };
    const service = new MemberSyncScheduleService(
      slackTeamsService as unknown as SlackTeamsService,
      jobs as unknown as JobsService,
    );

    expect(await service.syncDue(now)).toBe(2);

    expect(slackTeamsService.claimMemberSync).toHaveBeenCalledWith(
      'ws-1',
      new Date('2026-06-16T09:00:00.000Z'),
      now,
    );
    expect(
      jobs.run.mock.calls.map(([, { slackTeamId }]) => slackTeamId),
    ).toEqual(['ws-1', 'ws-3']);
  });
});
