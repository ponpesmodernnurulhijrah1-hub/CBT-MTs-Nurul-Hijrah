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

test('resolveDevicePerfTier routes entry-level (<=4 cores/RAM) to lite, mid-range (6-8) to balanced, and flagship/Hi-DPI desktop to high', () => {
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

  // Entry-level 4 GB RAM or 4-core device
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: 4,
      hardwareConcurrency: 8,
      isCoarsePointer: true,
    }),
    'lite'
  );
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 4,
      isCoarsePointer: false,
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

  // Mid-range 6-8 core / 6-8 GB phone or mid-range desktop gets balanced tier
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: 6,
      hardwareConcurrency: 8,
      isCoarsePointer: true,
    }),
    'balanced'
  );
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 6,
      devicePixelRatio: 1,
      isCoarsePointer: false,
    }),
    'balanced'
  );

  // Hi-DPI desktop or >8-core / >=8-core desktop gets high tier
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 6,
      devicePixelRatio: 2,
      isCoarsePointer: false,
    }),
    'high'
  );
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'desktop',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      isCoarsePointer: false,
    }),
    'high'
  );
  assert.equal(
    resolveDevicePerfTier({
      deviceType: 'mobile',
      deviceMemory: 12,
      hardwareConcurrency: 10,
      isCoarsePointer: true,
    }),
    'high'
  );
});

test('evaluateAdaptiveFpsStepDown steps down performance tier monotonically after 2 seconds <45 FPS', () => {
  // Single transient dip should not trigger step-down
  assert.equal(evaluateAdaptiveFpsStepDown('high', 30, 1), 'high');
  // 2 consecutive <45 FPS windows steps high -> balanced -> lite
  assert.equal(evaluateAdaptiveFpsStepDown('high', 42, 2), 'balanced');
  assert.equal(evaluateAdaptiveFpsStepDown('balanced', 40, 2), 'lite');
  // Healthy >=45 FPS preserves current tier
  assert.equal(evaluateAdaptiveFpsStepDown('high', 58, 4), 'high');
  assert.equal(evaluateAdaptiveFpsStepDown('balanced', 46, 3), 'balanced');
  assert.equal(evaluateAdaptiveFpsStepDown('lite', 20, 5), 'lite');
});
