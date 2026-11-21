import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCacheBustUrl,
  isNewerAppVersion,
  resolveMonotonicPulseVersion,
  shouldPurgeCacheName,
  shouldReloadForServiceWorkerUpdate,
  shouldTriggerAppUpdate,
  stripCacheBustParam,
} from './updaterLogic';

test('isNewerAppVersion and resolveMonotonicPulseVersion compare versions monotonically', () => {
  assert.equal(isNewerAppVersion('2026.11.21-v6', '2026.11.21-v5'), true);
  assert.equal(isNewerAppVersion('2026.11.21-v10', '2026.11.21-v6'), true);
  assert.equal(isNewerAppVersion('2026.11.21-v5', '2026.11.21-v6'), false);
  assert.equal(isNewerAppVersion('2026.11.21-v6', '2026.11.21-v6'), false);

  // Stale client cannot downgrade Firestore pulse version
  assert.equal(
    resolveMonotonicPulseVersion('2026.11.21-v4', '2026.11.21-v6'),
    '2026.11.21-v6'
  );
  // Newer client bumps stale Firestore pulse version forward
  assert.equal(
    resolveMonotonicPulseVersion('2026.11.21-v6', '2026.11.21-v5'),
    '2026.11.21-v6'
  );
});

test('shouldTriggerAppUpdate returns false when server and client versions match or server is older', () => {
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v6',
      serverVersion: '2026.11.21-v6',
    }),
    false
  );

  // Older remote pulse must never downgrade a newer client
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v6',
      serverVersion: '2026.11.21-v4',
    }),
    false
  );
});

test('shouldTriggerAppUpdate returns true once per new version and allows bounded cache-break retry if stale', () => {
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v5',
      serverVersion: '2026.11.21-v6',
      alreadyReloadedTarget: null,
    }),
    true
  );

  // Without retry context, stops after 1 reload to prevent loops
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v5',
      serverVersion: '2026.11.21-v6',
      alreadyReloadedTarget: '2026.11.21-v6',
    }),
    false
  );

  // With bounded retry context, allows 1 cache-busting recovery attempt after 8s if still stuck on old bundle
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v5',
      serverVersion: '2026.11.21-v6',
      alreadyReloadedTarget: '2026.11.21-v6',
      versionReloadAttempts: 1,
      lastReloadAttemptAtMs: 10_000,
      nowMs: 25_000,
    }),
    true
  );

  // Stops permanently once max 2 attempts reached in a session
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v5',
      serverVersion: '2026.11.21-v6',
      alreadyReloadedTarget: '2026.11.21-v6',
      versionReloadAttempts: 2,
      lastReloadAttemptAtMs: 10_000,
      nowMs: 60_000,
    }),
    false
  );
});

test('shouldTriggerAppUpdate detects buildId changes even without version bump and stays silent when identical', () => {
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v6',
      serverVersion: '2026.11.21-v6',
      clientBuildId: 'abc123',
      serverBuildId: 'abc123',
    }),
    false
  );

  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v6',
      serverVersion: '2026.11.21-v6',
      clientBuildId: 'abc123',
      serverBuildId: 'def456',
      alreadyReloadedBuildId: null,
    }),
    true
  );

  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.21-v6',
      serverVersion: '2026.11.21-v6',
      clientBuildId: 'abc123',
      serverBuildId: 'def456',
      alreadyReloadedBuildId: 'def456',
    }),
    false
  );
});

test('shouldPurgeCacheName purges workbox precaches and app runtime caches while preserving Google Fonts', () => {
  assert.equal(shouldPurgeCacheName('workbox-precache-v2-https://example.com/'), true);
  assert.equal(shouldPurgeCacheName('cbt-nurul-hijrah-pages'), true);
  assert.equal(shouldPurgeCacheName('cbt-nurul-hijrah-assets'), true);
  assert.equal(shouldPurgeCacheName('google-fonts-cache'), false);
});

test('buildCacheBustUrl and stripCacheBustParam preserve URL path and hash cleanly', () => {
  const busted = buildCacheBustUrl('https://cbt.example.com/portal?tab=admin#top', 'v6');
  assert.equal(busted, 'https://cbt.example.com/portal?tab=admin&_pwa_v=v6#top');
  assert.equal(stripCacheBustParam(busted), '/portal?tab=admin#top');
  assert.equal(stripCacheBustParam('https://cbt.example.com/portal?tab=admin#top'), null);
});

test('shouldReloadForServiceWorkerUpdate ignores dev SW updates and enforces cooldown in prod', () => {
  assert.equal(
    shouldReloadForServiceWorkerUpdate({
      isProd: false,
      lastSwReloadAtMs: null,
      nowMs: 100_000,
    }),
    false
  );

  assert.equal(
    shouldReloadForServiceWorkerUpdate({
      isProd: true,
      lastSwReloadAtMs: 90_000,
      nowMs: 100_000,
    }),
    false
  );

  assert.equal(
    shouldReloadForServiceWorkerUpdate({
      isProd: true,
      lastSwReloadAtMs: 10_000,
      nowMs: 100_000,
    }),
    true
  );
});
