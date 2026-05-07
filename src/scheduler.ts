import { setTimeout as delay } from "node:timers/promises";

export class Scheduler {
  private stopped = false;

  stop(): void {
    this.stopped = true;
  }

  async every(intervalMs: number, task: () => Promise<void>): Promise<void> {
    while (!this.stopped) {
      await task();
      await delay(intervalMs);
    }
  }
}
