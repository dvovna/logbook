import * as errorReporter from '@common/errors/error-reporter';
import * as shutdownState from '@common/utils/shutdown-state';
import { handleStartupFailure } from '@common/utils/startup-failure';

describe('handleStartupFailure', () => {
  const exit = jest.fn();
  let report: jest.SpyInstance;

  beforeEach(() => {
    exit.mockReset();
    report = jest
      .spyOn(errorReporter, 'reportError')
      .mockImplementation(() => undefined);
    jest.spyOn(errorReporter, 'flushErrorReports').mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reports a failed start and exits with 1', async () => {
    jest.spyOn(shutdownState, 'isShuttingDown').mockReturnValue(false);
    const error = new Error('no database');

    await handleStartupFailure(error, exit);

    expect(report).toHaveBeenCalledWith(error, { task: 'start the app' });
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('leaves a start that a shutdown cut off to the shutdown', async () => {
    jest.spyOn(shutdownState, 'isShuttingDown').mockReturnValue(true);

    await handleStartupFailure(
      new Error('driver has already been destroyed'),
      exit,
    );

    expect(report).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
