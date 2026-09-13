import { FlowError, type Clock } from './model.js';

export class Budget {
  private used = 0;
  constructor(
    private readonly clock: Clock,
    private readonly maximum: number,
  ) {}

  async call<T>(
    deadline: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (++this.used > this.maximum) throw new FlowError('request_budget');
    const remaining = deadline - this.clock.now();
    if (remaining <= 0) throw new FlowError('timeout');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new FlowError('timeout'));
            },
            Math.min(remaining, 10_000),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  }
}

export function retryable(error: unknown): error is FlowError {
  return (
    error instanceof FlowError &&
    ['transport', 'rate_limited', 'remote_failure'].includes(error.code)
  );
}

export function delayFor(backoff: number, error?: FlowError): number {
  return Math.max(backoff, error?.retryAfterMs ?? 0);
}
