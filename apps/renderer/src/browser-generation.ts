export interface BrowserGeneration<T> {
  closePromise: Promise<void> | null;
  handle: T | null;
  readonly id: number;
  readonly launch: Promise<T>;
  retired: boolean;
}

export interface BrowserGenerationOptions<T> {
  close: (handle: T) => Promise<void>;
  closeTimeoutMs: number;
  forceClose: (handle: T) => Promise<void>;
  forceCloseTimeoutMs: number;
  isUsable: (handle: T) => boolean;
  launch: () => Promise<T>;
  launchTimeoutMs: number;
}

function deadlineError(ms: number, action: string): Error {
  const error = new Error(`${action} exceeded its ${ms}ms deadline`);
  error.name = "TimeoutError";
  return error;
}

export function withDeadline<T>(promise: Promise<T>, ms: number, action: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(deadlineError(ms, action)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Owns one shared browser generation. A generation is detached before any
 * bounded close wait, so a timed-out render cannot make a late browser close
 * race with a replacement launch.
 */
export class BrowserGenerationManager<T> {
  private active: BrowserGeneration<T> | null = null;
  private readonly generations = new Set<BrowserGeneration<T>>();
  private nextId = 0;
  private readonly options: BrowserGenerationOptions<T>;
  private readonly shutdown = new AbortController();

  constructor(options: BrowserGenerationOptions<T>) {
    this.options = options;
  }

  async acquire(): Promise<{ generation: BrowserGeneration<T>; handle: T }> {
    if (this.shutdown.signal.aborted) {
      throw new Error("browser manager is closed");
    }

    let generation = this.active;
    if (!generation || generation.retired) {
      generation = this.start();
    } else if (generation.handle && !this.options.isUsable(generation.handle)) {
      this.retire(generation);
      generation = this.start();
    }

    try {
      const handle = await withDeadline(
        generation.launch,
        this.options.launchTimeoutMs,
        "browser launch"
      );
      if (generation.retired || this.active !== generation) {
        this.ensureClose(generation, handle);
        throw new Error("browser generation was retired during launch");
      }
      generation.handle = handle;
      return { generation, handle };
    } catch (error) {
      if (this.active === generation) {
        this.retire(generation);
      }
      throw error;
    }
  }

  isConnected(): boolean {
    const handle = this.active?.handle;
    return handle ? this.options.isUsable(handle) : false;
  }

  retire(generation: BrowserGeneration<T>): void {
    if (generation.retired) {
      return;
    }
    generation.retired = true;
    if (this.active === generation) {
      this.active = null;
    }
    if (generation.handle) {
      this.ensureClose(generation, generation.handle);
    }
  }

  async close(
    deadlineAt: number = Date.now() +
      this.options.launchTimeoutMs +
      this.options.closeTimeoutMs +
      this.options.forceCloseTimeoutMs
  ): Promise<void> {
    this.shutdown.abort();
    const generations = [...this.generations];
    if (generations.length === 0) {
      return;
    }
    for (const generation of generations) {
      this.retire(generation);
    }
    await Promise.all(
      generations.map((generation) =>
        this.settleByDeadline(
          generation.launch.then(
            () => undefined,
            () => undefined
          ),
          deadlineAt
        )
      )
    );
    await Promise.all(
      generations.map((generation) =>
        generation.closePromise
          ? this.settleByDeadline(generation.closePromise, deadlineAt)
          : Promise.resolve()
      )
    );
  }

  private start(): BrowserGeneration<T> {
    this.nextId += 1;
    const generation = {
      closePromise: null,
      handle: null,
      id: this.nextId,
      launch: Promise.resolve().then(this.options.launch),
      retired: false,
    } as BrowserGeneration<T>;
    this.active = generation;
    this.generations.add(generation);
    generation.launch.then(
      (handle) => {
        generation.handle = handle;
        if (generation.retired || this.active !== generation) {
          this.ensureClose(generation, handle);
        }
      },
      () => {
        this.generations.delete(generation);
      }
    );
    return generation;
  }

  private ensureClose(generation: BrowserGeneration<T>, handle: T): void {
    generation.closePromise ??= this.closeLate(handle).finally(() => {
      this.generations.delete(generation);
    });
  }

  private async closeLate(handle: T): Promise<void> {
    try {
      await withDeadline(this.options.close(handle), this.options.closeTimeoutMs, "browser close");
    } catch {
      try {
        await withDeadline(
          this.options.forceClose(handle),
          this.options.forceCloseTimeoutMs,
          "forced browser close"
        );
      } catch {
        // The force-close call has already delivered the kill signal. Do not
        // let waiting for process exit retain a detached generation forever.
      }
    }
  }

  private async settleByDeadline(promise: Promise<void>, deadlineAt: number): Promise<void> {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    if (remainingMs === 0) {
      return;
    }
    try {
      await withDeadline(promise, remainingMs, "browser manager shutdown");
    } catch {
      // Generation teardown continues independently after the manager has
      // detached it; shutdown itself must respect its absolute deadline.
    }
  }
}
