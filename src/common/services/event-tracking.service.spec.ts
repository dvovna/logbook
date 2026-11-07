import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventTrackingService } from '@common/services/event-tracking.service';
import { whenBackgroundWorkIsDone } from '@common/utils/run-in-background';

describe('EventTrackingService', () => {
  let eventEmitter: EventEmitter2;

  beforeEach(() => {
    eventEmitter = new EventEmitter2();
    new EventTrackingService(eventEmitter).onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  it('counts what the listeners do as background work', async () => {
    let finish = () => {};
    let done = false;
    eventEmitter.on('vacation_request.created', async () => {
      await new Promise<void>((resolve) => (finish = resolve));
      done = true;
    });

    expect(eventEmitter.emit('vacation_request.created', {})).toBe(true);
    const idle = whenBackgroundWorkIsDone();
    await new Promise((resolve) => setImmediate(resolve));
    expect(done).toBe(false);

    finish();
    await idle;
    expect(done).toBe(true);
  });

  it('logs a failing listener instead of throwing', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    eventEmitter.on('tab', async () => {
      throw new Error('Slack is down');
    });

    eventEmitter.emit('tab', {});
    await whenBackgroundWorkIsDone();

    expect(error).toHaveBeenCalledWith(
      'Failed to handle tab: Slack is down',
      expect.any(String),
    );
  });

  it('says whether anyone listens, as emit does', () => {
    expect(eventEmitter.emit('nobody', {})).toBe(false);
  });
});
