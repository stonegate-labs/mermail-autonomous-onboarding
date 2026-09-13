import type { Evidence, EventName } from './model.js';

// Allowlist projection: no arbitrary strings, identifiers, exception messages,
// email fields, artifacts, or hashes of low-entropy secrets can reach evidence.
export function record(
  events: Evidence[],
  event: EventName,
  elapsedMs: number,
  count?: number,
): void {
  events.push({ event, elapsedMs, ...(count === undefined ? {} : { count }) });
}
