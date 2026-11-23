import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_VERSION_STORAGE_KEY,
  SCHEMA_VERSION_STORAGE_KEY,
  buildCacheBustUrl,
  diagnoseVersionSync,
  isNewerAppVersion,
  migrateLegacyStorageSchema,
  resolveMonotonicPulseVersion,
  shouldPurgeCacheName,
  shouldReloadForServiceWorkerUpdate,
  shouldSoftReloadFromSwHeartbeat,
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

test('shouldTriggerAppUpdate detects buildId and buildHash changes cleanly', () => {
  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.22-v7',
      serverVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_aaa111',
      serverBuildHash: 'hash_aaa111',
    }),
    false
  );

  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.22-v7',
      serverVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_aaa111',
      serverBuildHash: 'hash_bbb222',
      alreadyReloadedBuildId: null,
    }),
    true
  );

  assert.equal(
    shouldTriggerAppUpdate({
      clientVersion: '2026.11.22-v7',
      serverVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_aaa111',
      serverBuildHash: 'hash_bbb222',
      alreadyReloadedBuildId: 'hash_bbb222',
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
  const busted = buildCacheBustUrl('https://cbt.example.com/portal?tab=admin#top', 'v7');
  assert.equal(busted, 'https://cbt.example.com/portal?tab=admin&_pwa_v=v7#top');
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

test('migrateLegacyStorageSchema cleans incompatible v1 keys, preserves valid v2 records, and sanitizes corrupt snapshots', () => {
  const mem = new Map<string, string>([
    ['cbt_mts_nurul_hijrah_db_v1', '{"old":true}'],
    ['cbt_mts_nurul_hijrah_seeded_v1', '1'],
    [APP_VERSION_STORAGE_KEY, '2026.11.22-v7'],
    ['cbt_mts_nurul_hijrah_db_v2', JSON.stringify({ subjects: [], classes: [], exams: [] })],
    ['cbt_mts_nurul_hijrah_sync_queue_v1', '[{"opId":"1"}]'],
  ]);
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  const res = migrateLegacyStorageSchema(storage, 7);
  assert.equal(res.migrated, true);
  assert.equal(res.sanitizedDb, false);
  assert.equal(mem.has('cbt_mts_nurul_hijrah_db_v1'), false);
  assert.equal(mem.has('cbt_mts_nurul_hijrah_seeded_v1'), false);
  assert.equal(mem.get(APP_VERSION_STORAGE_KEY), '2026.11.22-v7');
  assert.equal(mem.has('cbt_mts_nurul_hijrah_db_v2'), true);
  assert.equal(mem.has('cbt_mts_nurul_hijrah_sync_queue_v1'), true);
  assert.equal(mem.get(SCHEMA_VERSION_STORAGE_KEY), '7');

  // Corrupt db_v2 gets cleaned cleanly on schema upgrade
  mem.set(SCHEMA_VERSION_STORAGE_KEY, '6');
  mem.set('cbt_mts_nurul_hijrah_db_v2', '{corrupt-json');
  const res2 = migrateLegacyStorageSchema(storage, 7);
  assert.equal(res2.migrated, true);
  assert.equal(res2.sanitizedDb, true);
  assert.equal(mem.has('cbt_mts_nurul_hijrah_db_v2'), false);
});

test('diagnoseVersionSync identifies synced state, stale version, stale hash, and Firestore pulse mismatch', () => {
  const synced = diagnoseVersionSync({
    clientVersion: '2026.11.22-v7',
    clientBuildHash: 'abc12345',
    serverVersion: '2026.11.22-v7',
    serverBuildHash: 'abc12345',
  });
  assert.equal(synced.isSynced, true);
  assert.equal(synced.status, 'synced');

  const staleHash = diagnoseVersionSync({
    clientVersion: '2026.11.22-v7',
    clientBuildHash: 'oldhash11',
    serverVersion: '2026.11.22-v7',
    serverBuildHash: 'newhash22',
  });
  assert.equal(staleHash.isSynced, false);
  assert.equal(staleHash.status, 'stale_hash');

  const staleVer = diagnoseVersionSync({
    clientVersion: '2026.11.21-v6',
    clientBuildHash: 'oldhash11',
    serverVersion: '2026.11.22-v7',
    serverBuildHash: 'newhash22',
  });
  assert.equal(staleVer.isSynced, false);
  assert.equal(staleVer.status, 'stale_version');

  const stalePulse = diagnoseVersionSync({
    clientVersion: '2026.11.21-v6',
    clientBuildHash: 'oldhash11',
    serverVersion: null,
    serverBuildHash: null,
    pulseVersion: '2026.11.22-v7',
  });
  assert.equal(stalePulse.isSynced, false);
  assert.equal(stalePulse.status, 'stale_pulse');
});

test('shouldSoftReloadFromSwHeartbeat triggers soft reload only on hash/newer version mismatch and honors loop guard', () => {
  assert.equal(
    shouldSoftReloadFromSwHeartbeat({
      clientVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_abc123',
      swVersion: '2026.11.22-v7',
      swBuildHash: 'hash_abc123',
    }),
    false
  );

  assert.equal(
    shouldSoftReloadFromSwHeartbeat({
      clientVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_abc123',
      swVersion: '2026.11.22-v7',
      swBuildHash: 'hash_xyz999',
    }),
    true
  );

  assert.equal(
    shouldSoftReloadFromSwHeartbeat({
      clientVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_abc123',
      swVersion: '2026.11.22-v7',
      swBuildHash: 'hash_xyz999',
      alreadyReloadedForSwHash: 'hash_xyz999',
    }),
    false
  );

  assert.equal(
    shouldSoftReloadFromSwHeartbeat({
      clientVersion: '2026.11.22-v7',
      clientBuildHash: 'hash_abc123',
      swVersion: '2026.11.23-v8',
      swBuildHash: '',
    }),
    true
  );
});
