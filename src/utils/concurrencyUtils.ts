/**
 * Pure concurrency, rate-limiting, throttling, and unbiased shuffling utilities
 * designed for >100 concurrent CBT users without server/DB saturation or browser crashes.
 */

export function shuffleFisherYates<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Executes async tasks over an array using a strict concurrency pool limit
 * so broadcasting to 100+ sessions does not overwhelm browser sockets or Firestore RPC queues.
 */
export async function runWithConcurrencyLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * Removes expired timestamp entries from an in-memory TTL Map to avoid unbounded memory growth.
 */
export function pruneExpiredMapEntries<K>(
  map: Map<K, number>,
  nowMs: number = Date.now(),
  ttlMs: number = 15_000
): number {
  let removed = 0;
  for (const [key, createdAt] of map.entries()) {
    if (!Number.isFinite(createdAt) || nowMs - createdAt > ttlMs) {
      map.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export interface AdaptiveHeartbeatInput {
  nowMs: number;
  lastHeartbeatAtMs: number;
  lastSnapshotAtMs: number;
  lastTelemetrySignature: string;
  currentTelemetrySignature: string;
  hasPriorityChange: boolean;
  heartbeatIntervalMs?: number;
  snapshotIntervalMs?: number;
}

export interface AdaptiveHeartbeatDecision {
  shouldWriteDoc: boolean;
  shouldIncludeSnapshot: boolean;
}

/**
 * Prevents >100 concurrent student browsers from saturating Firestore with identical
 * 2.5s snapshot preview uploads while preserving instant alerts on violations/warnings.
 */
export function evaluateProctorHeartbeatDecision(
  input: AdaptiveHeartbeatInput
): AdaptiveHeartbeatDecision {
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? 7_000;
  const snapshotIntervalMs = input.snapshotIntervalMs ?? 14_000;

  const heartbeatAge = Math.max(0, input.nowMs - input.lastHeartbeatAtMs);
  const snapshotAge = Math.max(0, input.nowMs - input.lastSnapshotAtMs);
  const telemetryChanged = input.lastTelemetrySignature !== input.currentTelemetrySignature;

  const shouldWriteDoc =
    input.hasPriorityChange || telemetryChanged || heartbeatAge >= heartbeatIntervalMs;

  if (!shouldWriteDoc) {
    return { shouldWriteDoc: false, shouldIncludeSnapshot: false };
  }

  const shouldIncludeSnapshot =
    input.hasPriorityChange || snapshotAge >= snapshotIntervalMs || input.lastSnapshotAtMs === 0;

  return {
    shouldWriteDoc: true,
    shouldIncludeSnapshot,
  };
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

/**
 * Bounded per-key sliding-window rate limiter with automatic stale key cleanup
 * so >100 concurrent clients cannot trigger unbounded memory leaks or quota exhaustion.
 */
export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private opsSincePrune = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly maxBuckets = 2000
  ) {}

  consume(key: string, nowMs: number = Date.now()): RateLimitResult {
    this.opsSincePrune += 1;
    if (this.opsSincePrune >= 100 || this.buckets.size > this.maxBuckets) {
      this.prune(nowMs);
      this.opsSincePrune = 0;
    }

    const safeKey = key || 'anonymous';
    const cutoff = nowMs - this.windowMs;
    const prev = this.buckets.get(safeKey) || [];
    const active = prev.filter((ts) => ts > cutoff);

    if (active.length >= this.maxRequests) {
      const oldestActive = active[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, oldestActive + this.windowMs - nowMs);
      this.buckets.set(safeKey, active);
      return {
        allowed: false,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
        remaining: 0,
      };
    }

    active.push(nowMs);
    this.buckets.set(safeKey, active);
    return {
      allowed: true,
      retryAfterSec: 0,
      remaining: Math.max(0, this.maxRequests - active.length),
    };
  }

  prune(nowMs: number = Date.now()): void {
    const cutoff = nowMs - this.windowMs;
    for (const [k, list] of this.buckets.entries()) {
      const active = list.filter((ts) => ts > cutoff);
      if (active.length === 0) {
        this.buckets.delete(k);
      } else {
        this.buckets.set(k, active);
      }
    }
    if (this.buckets.size > this.maxBuckets) {
      const overflow = this.buckets.size - this.maxBuckets;
      let removed = 0;
      for (const k of this.buckets.keys()) {
        this.buckets.delete(k);
        removed += 1;
        if (removed >= overflow) break;
      }
    }
  }

  get bucketCount(): number {
    return this.buckets.size;
  }
}

export class QueueFullError extends Error {
  constructor(message = 'Antrean server sedang penuh. Coba lagi sebentar.') {
    super(message);
    this.name = 'QueueFullError';
  }
}

/**
 * Bounded FIFO async semaphore preventing >100 simultaneous outbound Gemini API calls
 * from overwhelming Node sockets or exhausting upstream API RPM limits.
 */
export class AsyncSemaphore {
  private active = 0;
  private readonly queue: Array<{
    resolve: (release: () => void) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }> = [];

  constructor(
    private readonly maxConcurrent: number,
    private readonly maxQueueSize: number = 40,
    private readonly maxWaitMs: number = 15_000
  ) {}

  acquire(): Promise<() => void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(this.createReleaser());
    }

    if (this.queue.length >= this.maxQueueSize) {
      return Promise.reject(new QueueFullError());
    }

    return new Promise((resolve, reject) => {
      const entry: {
        resolve: (release: () => void) => void;
        reject: (err: Error) => void;
        timer: ReturnType<typeof setTimeout> | null;
      } = {
        resolve,
        reject,
        timer: null,
      };

      if (this.maxWaitMs > 0) {
        entry.timer = setTimeout(() => {
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
            reject(new QueueFullError('Server sedang sibuk memproses permintaan lain.'));
          }
        }, this.maxWaitMs);
      }

      this.queue.push(entry);
    });
  }

  private createReleaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active = Math.max(0, this.active - 1);
      const next = this.queue.shift();
      if (next) {
        if (next.timer !== null) clearTimeout(next.timer);
        this.active += 1;
        next.resolve(this.createReleaser());
      }
    };
  }

  get activeCount(): number {
    return this.active;
  }

  get waitingCount(): number {
    return this.queue.length;
  }
}
