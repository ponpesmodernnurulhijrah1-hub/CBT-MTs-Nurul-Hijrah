import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConnectionTimeoutError,
  computeRetryDelayMs,
  deriveConnectionBannerState,
  retryLazyImport,
  withTimeout,
} from './connectionUtils';

test('withTimeout resolves fast promises and rejects stalled promises within limit', async () => {
  const fast = await withTimeout(Promise.resolve('ok'), 500, 'timeout');
  assert.equal(fast, 'ok');

  await assert.rejects(
    () =>
      withTimeout(
        new Promise((resolve) => setTimeout(() => resolve('late'), 500)),
        60,
        'Koneksi habis'
      ),
    (err: unknown) => err instanceof ConnectionTimeoutError && err.message === 'Koneksi habis'
  );
});

test('computeRetryDelayMs scales exponentially with strict upper bound', () => {
  assert.equal(computeRetryDelayMs(1, 1500, 8000), 1500);
  assert.equal(computeRetryDelayMs(2, 1500, 8000), 3000);
  assert.equal(computeRetryDelayMs(3, 1500, 8000), 6000);
  assert.equal(computeRetryDelayMs(4, 1500, 8000), 8000);
});

test('deriveConnectionBannerState hides banner when connected or fast-connecting and surfaces recovery controls on slow/error states', () => {
  const fastConnecting = deriveConnectionBannerState({
    phase: 'connecting',
    attempt: 0,
    maxAttempts: 3,
    hasConfirmedCloudSync: false,
    slowConnectingElapsed: false,
  });
  assert.equal(fastConnecting.visible, false);

  const slowConnecting = deriveConnectionBannerState({
    phase: 'connecting',
    attempt: 0,
    maxAttempts: 3,
    hasConfirmedCloudSync: false,
    slowConnectingElapsed: true,
  });
  assert.equal(slowConnecting.visible, true);
  assert.equal(slowConnecting.tone, 'info');
  assert.equal(slowConnecting.showRetryButton, true);

  const retrying = deriveConnectionBannerState({
    phase: 'retrying',
    attempt: 2,
    maxAttempts: 3,
    hasConfirmedCloudSync: false,
    slowConnectingElapsed: true,
  });
  assert.equal(retrying.visible, true);
  assert.equal(retrying.tone, 'warning');
  assert.match(retrying.title, /2\/3/);

  const error = deriveConnectionBannerState({
    phase: 'error',
    attempt: 3,
    maxAttempts: 3,
    errorMessage: 'Timeout Firestore',
    hasConfirmedCloudSync: false,
    slowConnectingElapsed: true,
  });
  assert.equal(error.visible, true);
  assert.equal(error.tone, 'error');
  assert.equal(error.detail, 'Timeout Firestore');
  assert.equal(error.showRetryButton, true);

  const connected = deriveConnectionBannerState({
    phase: 'connected',
    attempt: 0,
    maxAttempts: 3,
    hasConfirmedCloudSync: true,
    slowConnectingElapsed: true,
  });
  assert.equal(connected.visible, false);
});

test('retryLazyImport recovers transient dynamic import failure once', async () => {
  let calls = 0;
  const mod = await retryLazyImport(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('Chunk fetch failed');
      return { loaded: true };
    },
    1,
    10
  );
  assert.equal(calls, 2);
  assert.deepEqual(mod, { loaded: true });
});
