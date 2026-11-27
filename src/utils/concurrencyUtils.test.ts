import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AsyncSemaphore,
  evaluateProctorHeartbeatDecision,
  pruneExpiredMapEntries,
  QueueFullError,
  runWithConcurrencyLimit,
  shuffleFisherYates,
  SlidingWindowRateLimiter,
} from './concurrencyUtils';

test('shuffleFisherYates preserves all items without mutating source', () => {
  const original = [1, 2, 3, 4, 5, 6, 7, 8];
  let step = 0;
  const deterministicRng = () => {
    step += 1;
    return ((step * 37) % 100) / 100;
  };
  const shuffled = shuffleFisherYates(original, deterministicRng);
  assert.deepEqual(original, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), original);
  assert.notDeepEqual(shuffled, original);
});

test('runWithConcurrencyLimit respects max in-flight concurrency and preserves order', async () => {
  let active = 0;
  let maxSeen = 0;
  const items = Array.from({ length: 12 }, (_, i) => i + 1);

  const res = await runWithConcurrencyLimit(items, 3, async (n) => {
    active += 1;
    maxSeen = Math.max(maxSeen, active);
    await new Promise((r) => setTimeout(r, 8));
    active -= 1;
    return n * 10;
  });

  assert.equal(maxSeen <= 3, true);
  assert.deepEqual(
    res,
    items.map((n) => n * 10)
  );
});

test('evaluateProctorHeartbeatDecision deduplicates redundant unchanged ticks and throttles snapshots', () => {
  // Priority warning always forces write + snapshot
  const priority = evaluateProctorHeartbeatDecision({
    nowMs: 10_000,
    lastHeartbeatAtMs: 9_000,
    lastSnapshotAtMs: 9_000,
    lastTelemetrySignature: 'sig1',
    currentTelemetrySignature: 'sig1',
    hasPriorityChange: true,
  });
  assert.deepEqual(priority, { shouldWriteDoc: true, shouldIncludeSnapshot: true });

  // Unchanged within 7s skips Firestore write completely
  const skip = evaluateProctorHeartbeatDecision({
    nowMs: 12_000,
    lastHeartbeatAtMs: 9_000,
    lastSnapshotAtMs: 9_000,
    lastTelemetrySignature: 'sig1',
    currentTelemetrySignature: 'sig1',
    hasPriorityChange: false,
  });
  assert.deepEqual(skip, { shouldWriteDoc: false, shouldIncludeSnapshot: false });

  // After 7s heartbeat writes lightweight status without snapshot until 14s
  const lightHeartbeat = evaluateProctorHeartbeatDecision({
    nowMs: 17_000,
    lastHeartbeatAtMs: 9_000,
    lastSnapshotAtMs: 9_000,
    lastTelemetrySignature: 'sig1',
    currentTelemetrySignature: 'sig1',
    hasPriorityChange: false,
  });
  assert.deepEqual(lightHeartbeat, { shouldWriteDoc: true, shouldIncludeSnapshot: false });

  // After 14s heartbeat also refreshes JPEG snapshot
  const fullHeartbeat = evaluateProctorHeartbeatDecision({
    nowMs: 24_000,
    lastHeartbeatAtMs: 17_000,
    lastSnapshotAtMs: 9_000,
    lastTelemetrySignature: 'sig1',
    currentTelemetrySignature: 'sig1',
    hasPriorityChange: false,
  });
  assert.deepEqual(fullHeartbeat, { shouldWriteDoc: true, shouldIncludeSnapshot: true });
});

test('SlidingWindowRateLimiter enforces per-key window and prunes stale buckets', () => {
  const limiter = new SlidingWindowRateLimiter(3, 10_000, 100);
  assert.equal(limiter.consume('ip-a', 1000).allowed, true);
  assert.equal(limiter.consume('ip-a', 2000).allowed, true);
  assert.equal(limiter.consume('ip-a', 3000).allowed, true);
  const blocked = limiter.consume('ip-a', 4000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);

  // Separate client is independent
  assert.equal(limiter.consume('ip-b', 4000).allowed, true);

  // After window expires, ip-a is allowed again and pruning removes old entries
  assert.equal(limiter.consume('ip-a', 12_000).allowed, true);
  limiter.prune(30_000);
  assert.equal(limiter.bucketCount, 0);
});

test('AsyncSemaphore bounds concurrency and rejects cleanly when queue is full', async () => {
  const sem = new AsyncSemaphore(2, 1, 500);
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  assert.equal(sem.activeCount, 2);

  const p3 = sem.acquire(); // queued (1/1)
  assert.equal(sem.waitingCount, 1);

  await assert.rejects(() => sem.acquire(), QueueFullError);

  r1();
  const r3 = await p3;
  assert.equal(sem.activeCount, 2);
  r2();
  r3();
  assert.equal(sem.activeCount, 0);
});

test('pruneExpiredMapEntries cleans expired IDs and keeps fresh entries', () => {
  const m = new Map<string, number>([
    ['old', 1000],
    ['fresh', 18_000],
  ]);
  const removed = pruneExpiredMapEntries(m, 20_000, 15_000);
  assert.equal(removed, 1);
  assert.equal(m.has('old'), false);
  assert.equal(m.has('fresh'), true);
});
