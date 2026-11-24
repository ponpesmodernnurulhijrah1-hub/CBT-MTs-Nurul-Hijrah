import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDeviceType,
  detectInstalledDisplayMode,
  evaluateAdaptiveFpsStepDown,
  isViewportStuckInDesktopFallback,
  resolveDevicePerfTier,
  resolveEffectiveViewportWidth,
} from './deviceViewport';

test('classifyDeviceType distinguishes mobile, tablet, and desktop breakpoints cleanly', () => {
  assert.equal(classifyDeviceType(360), 'mobile');
  assert.equal(classifyDeviceType(390), 'mobile');
  assert.equal(classifyDeviceType(639), 'mobile');
  assert.equal(classifyDeviceType(640), 'tablet');
  assert.equal(classifyDeviceType(768), 'tablet');
  assert.equal(classifyDeviceType(1023), 'tablet');
  assert.equal(classifyDeviceType(1024), 'desktop');
  assert.equal(classifyDeviceType(1440), 'desktop');
});

test('resolveEffectiveViewportWidth selects accurate minimum positive viewport width', () => {
  assert.equal(
    resolveEffectiveViewportWidth({
      innerWidth: 980,
      clientWidth: 980,
      visualViewportWidth: 390,
    }),
    390
  );
  assert.equal(
    resolveEffectiveViewportWidth({
      innerWidth: 768,
      clientWidth: 768,
      visualViewportWidth: null,
    }),
    768
  );
});

test('isViewportStuckInDesktopFallback flags 980px desktop layout on touch phones and ignores desktop monitors', () => {
  assert.equal(
    isViewportStuckInDesktopFallback({
      clientWidth: 980,
      screenWidth: 390,
      isTouchDevice: true,
    }),
    true
  );

  assert.equal(
    isViewportStuckInDesktopFallback({
      clientWidth: 390,
      screenWidth: 390,
      isTouchDevice: true,
    }),
    false
  );

  assert.equal(
    isViewportStuckInDesktopFallback({
      clientWidth: 1280,
      screenWidth: 1440,
      isTouchDevice: false,
    }),
    false
  );
});

test('detectInstalledDisplayMode detects standalone PWAs vs regular browser tabs', () => {
  assert.equal(detectInstalledDisplayMode(true, false), 'standalone');
  assert.equal(detectInstalledDisplayMode(false, true), 'standalone');
  assert.equal(detectInstalledDisplayMode(false, false), 'browser');
});

test('resolveDevicePerfTier routes entry-level phones to lite, mid-range phones to balanced, and desktop to high', () => {
  // Entry-level 2 GB RAM / 4-core Android smartphone
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: 2,
      hardwareConcurrency: 4,
      isCoarsePointer: true,
    }),
    'lite'
  );

  // Entry-level 4-core phone where deviceMemory API is unavailable (e.g., WebView/Safari)
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: null,
      hardwareConcurrency: 4,
      isCoarsePointer: true,
    }),
    'lite'
  );

  // Save-Data / 2G connection forces lite
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      saveData: true,
    }),
    'lite'
  );
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'tablet',
      deviceMemory: 6,
      hardwareConcurrency: 8,
      effectiveType: '2g',
    }),
    'lite'
  );

  // Mid-range 6-8 core mobile phone gets balanced tier
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: 6,
      hardwareConcurrency: 8,
      isCoarsePointer: true,
    }),
    'balanced'
  );

  // High-spec desktop gets full Hyper-Liquid high tier
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      isCoarsePointer: false,
    }),
    'high'
  );
});

test('evaluateAdaptiveFpsStepDown steps down performance tier monotonically on sustained low FPS', () => {
  // Single transient dip should not trigger step-down
  assert.equal(evaluateAdaptiveFpsStepDown('high', 30, 1), 'high');
  // Sustained low FPS steps high -> balanced -> lite
  assert.equal(evaluateAdaptiveFpsStepDown('high', 38, 2), 'balanced');
  assert.equal(evaluateAdaptiveFpsStepDown('balanced', 28, 2), 'lite');
  // Healthy FPS preserves current tier
  assert.equal(evaluateAdaptiveFpsStepDown('high', 58, 4), 'high');
  assert.equal(evaluateAdaptiveFpsStepDown('balanced', 45, 3), 'balanced');
  assert.equal(evaluateAdaptiveFpsStepDown('lite', 20, 5), 'lite');
});
