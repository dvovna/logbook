import { Logger } from '@nestjs/common';
import { Response } from 'express';
import { AppController, HEALTH_TIMEOUT_MS } from 'src/app.controller';
import { DatabaseService } from 'src/database/database.service';

const controllerAnswering = (ping: () => Promise<void>) =>
  new AppController({ ping } as unknown as DatabaseService);

const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);

  return res;
};

describe('GET /health', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('answers 200 while the database answers', async () => {
    const res = response();

    await controllerAnswering(() => Promise.resolve()).getHealth(
      res as unknown as Response,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
  });

  it('answers 503, without the details, when the database fails', async () => {
    const res = response();

    await controllerAnswering(() =>
      Promise.reject(new Error('too many clients')),
    ).getHealth(res as unknown as Response);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ status: 'unavailable' });
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      'Health check: the database: too many clients',
    );
  });

  it('answers 503 when the database does not answer in time', async () => {
    jest.useFakeTimers();
    const res = response();

    const checking = controllerAnswering(() => new Promise(() => {})).getHealth(
      res as unknown as Response,
    );
    await jest.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS);
    await checking;

    expect(res.status).toHaveBeenCalledWith(503);
  });
});
