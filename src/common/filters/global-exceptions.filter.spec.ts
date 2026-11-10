import {
  ArgumentsHost,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionsFilter } from '@common/filters/global-exceptions.filter';
import * as errorReporter from '@common/errors/error-reporter';

const hostFor = (headersSent = false) => {
  const response = {
    headersSent,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ url: '/api/slack/interactions?code=secret' }),
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
};

describe('GlobalExceptionsFilter', () => {
  const filter = new GlobalExceptionsFilter();
  let error: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('answers 500 without the error text and logs it once with its stack', () => {
    const { host, response } = hostFor();
    const failure = new Error('relation "users" violates constraint');

    filter.catch(failure, host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        path: '/api/slack/interactions',
        error: 'Internal server error',
      }),
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      '500 relation "users" violates constraint | Path: /api/slack/interactions',
      failure.stack,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('answers a client error with its status and message, as a warning', () => {
    const { host, response } = hostFor();

    filter.catch(new NotFoundException('Team not found'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, error: 'Team not found' }),
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps the details of an exception in the log, not in the answer', () => {
    const { host, response } = hostFor();

    filter.catch(
      new ForbiddenException({ user_slack_id: 'U1', team_id: 'team-1' }),
      host,
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        error: 'Forbidden Exception',
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"user_slack_id":"U1"'),
    );
  });

  it('reports unexpected errors to error tracking, not client errors', () => {
    const report = jest.spyOn(errorReporter, 'reportError');
    const failure = new Error('database down');

    filter.catch(failure, hostFor().host);
    filter.catch(new NotFoundException('Team not found'), hostFor().host);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure, {
      path: '/api/slack/interactions',
      status: 500,
    });
  });

  it('only logs when the answer went out already', () => {
    const { host, response } = hostFor(true);

    filter.catch(new Error('after the answer'), host);

    expect(response.status).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
