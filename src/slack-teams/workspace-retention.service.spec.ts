import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as errorReporter from '@common/errors/error-reporter';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { WorkspaceRetentionService } from 'src/slack-teams/workspace-retention.service';

const NOW = new Date('2026-06-17T12:00:00.000Z');
const THIRTY_DAYS_AGO = new Date('2026-05-18T12:00:00.000Z');

describe('WorkspaceRetentionService', () => {
  let slackTeamsService: {
    findUninstalledBefore: jest.Mock;
    deleteWorkspace: jest.Mock;
  };
  let service: WorkspaceRetentionService;
  let logError: jest.SpyInstance;
  let report: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate'] });
    slackTeamsService = {
      findUninstalledBefore: jest.fn().mockResolvedValue(['a', 'b', 'c']),
      deleteWorkspace: jest.fn().mockResolvedValue(true),
    };
    service = new WorkspaceRetentionService(
      slackTeamsService as unknown as SlackTeamsService,
      { getOrThrow: () => 30 } as unknown as ConfigService,
    );
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    report = jest.spyOn(errorReporter, 'reportError').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('deletes each workspace uninstalled before the retention period on its own', async () => {
    await expect(service.deleteExpired()).resolves.toBe(3);

    expect(slackTeamsService.findUninstalledBefore).toHaveBeenCalledWith(
      THIRTY_DAYS_AGO,
    );
    expect(slackTeamsService.deleteWorkspace.mock.calls).toEqual([
      ['a', THIRTY_DAYS_AGO],
      ['b', THIRTY_DAYS_AGO],
      ['c', THIRTY_DAYS_AGO],
    ]);
  });

  it('deletes the other workspaces when one fails, and reports that one', async () => {
    const failure = new Error('canceling statement due to statement timeout');
    slackTeamsService.deleteWorkspace.mockImplementation((id: string) =>
      id === 'a' ? Promise.reject(failure) : Promise.resolve(true),
    );

    await expect(service.deleteExpired()).resolves.toBe(2);

    expect(slackTeamsService.deleteWorkspace).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalledWith(
      'Could not delete the uninstalled workspace a: canceling statement due to statement timeout',
      failure.stack,
    );
    expect(report).toHaveBeenCalledWith(failure, {
      task: 'delete an uninstalled workspace',
      slackTeamId: 'a',
    });
  });

  it('does not count a workspace installed again before its turn', async () => {
    slackTeamsService.deleteWorkspace.mockImplementation((id: string) =>
      Promise.resolve(id !== 'b'),
    );

    await expect(service.deleteExpired()).resolves.toBe(2);
  });
});
