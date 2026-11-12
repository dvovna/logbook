import { ConcurrencyLimit } from '@common/utils/concurrency-limit';

// A task that runs until the test ends it.
const gate = () => {
  let open!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });

  return { done, open, fail };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('ConcurrencyLimit', () => {
  it('runs at most `limit` tasks at once, the others in the order they came', async () => {
    const limit = new ConcurrencyLimit(2);
    const gates = [gate(), gate(), gate(), gate()];
    const started: number[] = [];
    const runs = gates.map((task, index) =>
      limit.run(() => {
        started.push(index);

        return task.done.then(() => index);
      }),
    );

    await flush();
    expect(started).toEqual([0, 1]);

    gates[1].open();
    await flush();
    expect(started).toEqual([0, 1, 2]);

    gates[0].open();
    gates[2].open();
    gates[3].open();

    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2, 3]);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('frees the slot of a task that failed', async () => {
    const limit = new ConcurrencyLimit(1);
    const first = gate();
    const failed = limit.run(() => first.done);
    const next = limit.run(() => Promise.resolve('next'));

    first.fail(new Error('Slack is down'));

    await expect(failed).rejects.toThrow('Slack is down');
    await expect(next).resolves.toBe('next');
  });

  it('frees a slot once however often its release is called', async () => {
    const limit = new ConcurrencyLimit(1);
    const release = await limit.acquire();
    const started: string[] = [];
    const second = limit.run(async () => {
      started.push('second');
      await flush();
    });
    const third = limit.run(async () => {
      started.push('third');
    });

    release();
    release();
    await flush();

    expect(started).toEqual(['second']);
    await Promise.all([second, third]);
    expect(started).toEqual(['second', 'third']);
  });

  it('takes a free slot without waiting, and none when all are taken', async () => {
    const limit = new ConcurrencyLimit(2);
    const first = await limit.acquire();
    const second = limit.tryAcquire();

    expect(second).toEqual(expect.any(Function));
    expect(limit.tryAcquire()).toBeNull();

    const started: string[] = [];
    const waiting = limit.run(async () => {
      started.push('waiting');
    });

    second!();
    await waiting;
    expect(started).toEqual(['waiting']);
    // The waiting task had the slot: one is free again now that it ended.
    expect(limit.tryAcquire()).toEqual(expect.any(Function));
    expect(limit.tryAcquire()).toBeNull();
    first();
  });

  it('refuses a limit that lets nothing run', () => {
    expect(() => new ConcurrencyLimit(0)).toThrow(
      'A concurrency limit of 0 lets nothing run',
    );
  });
});
