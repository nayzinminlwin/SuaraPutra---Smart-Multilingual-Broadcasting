import { DeliveryQueue } from './queue.js';

type TimerHandle = ReturnType<typeof setInterval>;

export type RecoverySchedulerOptions = Readonly<{
  intervalMs?: number;
  setInterval?: (handler: () => void, timeout: number) => TimerHandle;
  clearInterval?: (handle: TimerHandle) => void;
}>;

export class DeliveryRecoveryScheduler {
  private readonly intervalMs: number;
  private readonly setIntervalFn: (handler: () => void, timeout: number) => TimerHandle;
  private readonly clearIntervalFn: (handle: TimerHandle) => void;
  private timer: TimerHandle | null = null;
  private running = false;

  constructor(
    private readonly queue: DeliveryQueue,
    options: RecoverySchedulerOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? 60_000;
    this.setIntervalFn = options.setInterval ?? setInterval;
    this.clearIntervalFn = options.clearInterval ?? clearInterval;
  }

  start(): number {
    if (this.timer !== null) return 0;
    const recovered = this.runRecovery();
    this.timer = this.setIntervalFn(() => {
      if (this.running) return;
      this.running = true;
      try {
        this.queue.recoverOrphanedJobs();
      } catch (error) {
        this.queue.recordRecoveryFailure(error);
      } finally {
        this.running = false;
      }
    }, this.intervalMs);
    return recovered;
  }

  stop(): void {
    if (this.timer === null) return;
    this.clearIntervalFn(this.timer);
    this.timer = null;
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  private runRecovery(): number {
    try {
      return this.queue.recoverOrphanedJobs();
    } catch (error) {
      this.queue.recordRecoveryFailure(error);
      return 0;
    }
  }
}
