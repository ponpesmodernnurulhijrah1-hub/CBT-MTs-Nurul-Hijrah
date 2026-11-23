import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDeviceType,
  detectInstalledDisplayMode,
  isViewportStuckInDesktopFallback,
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
