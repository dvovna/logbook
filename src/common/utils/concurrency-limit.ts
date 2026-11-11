// Lets at most `limit` tasks run at once; the others wait for a free slot in
// the order they asked for one.
export class ConcurrencyLimit {
  private running = 0;

  private readonly waiting: (() => void)[] = [];

  public constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`A concurrency limit of ${limit} lets nothing run`);
    }
  }

  // Resolves once a slot is free, with what frees it again when the task is
  // over (a second call does nothing).
  public async acquire(): Promise<() => void> {
    if (this.running < this.limit) {
      this.running += 1;
    } else {
      // release() hands its slot straight to the next one, so `running`
      // stays as it is.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }

    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.release();
    };
  }

  public async run<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquire();

    try {
      return await task();
    } finally {
      release();
    }
  }

  private release() {
    const next = this.waiting.shift();

    if (next) {
      next();
    } else {
      this.running -= 1;
    }
  }
}
