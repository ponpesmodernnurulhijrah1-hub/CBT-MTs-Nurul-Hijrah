import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRelativeSpecularCoords,
  computeCardTiltAndSheen,
  computeMagneticPull,
  computeMorphIndicatorRect,
  computeMorphStretchMetrics,
  computeOptionStaggerDelayMs,
  computeRippleMetrics,
  computeSharedElementFlipTransform,
  resolveActiveMotionLayerState,
  resolveMorphActiveDurationMs,
  resolveMotionProfileForTier,
  resolveQuestionSlideDirection,
  resolveTabSlideDirection,
} from './liquidMotion';

test('resolveTabSlideDirection determines forward, backward, and none accurately', () => {
  const tabs = ['analitik', 'bank-soal', 'import', 'jadwal', 'monitoring', 'hasil'] as const;

  assert.equal(resolveTabSlideDirection(tabs, null, 'analitik'), 'none');
  assert.equal(resolveTabSlideDirection(tabs, 'analitik', 'analitik'), 'none');
  assert.equal(resolveTabSlideDirection(tabs, 'analitik', 'jadwal'), 'forward');
  assert.equal(resolveTabSlideDirection(tabs, 'monitoring', 'bank-soal'), 'backward');
  assert.equal(resolveTabSlideDirection(tabs, 'hasil', 'analitik'), 'backward');
});

test('resolveQuestionSlideDirection handles forward, backward, and invalid indices', () => {
  assert.equal(resolveQuestionSlideDirection(0, 1), 'forward');
  assert.equal(resolveQuestionSlideDirection(4, 1), 'backward');
  assert.equal(resolveQuestionSlideDirection(2, 2), 'none');
  assert.equal(resolveQuestionSlideDirection(Number.NaN, 1), 'none');
});

test('clampRelativeSpecularCoords clamps pointer coordinates safely inside 0..100%', () => {
  const rect = { left: 100, top: 200, width: 200, height: 100 };

  assert.deepEqual(clampRelativeSpecularCoords(200, 250, rect), {
    xPercent: 50,
    yPercent: 50,
  });
  assert.deepEqual(clampRelativeSpecularCoords(0, 0, rect), {
    xPercent: 0,
    yPercent: 0,
  });
  assert.deepEqual(clampRelativeSpecularCoords(500, 500, rect), {
    xPercent: 100,
    yPercent: 100,
  });
  assert.deepEqual(
    clampRelativeSpecularCoords(150, 225, { left: 0, top: 0, width: 0, height: 100 }),
    { xPercent: 50, yPercent: 50 }
  );
});

test('computeMorphIndicatorRect offsets coordinates cleanly with container scroll', () => {
  const pill = computeMorphIndicatorRect(
    { left: 20, top: 10, scrollLeft: 64, scrollTop: 0 },
    { left: 100, top: 14, width: 120, height: 38 }
  );

  assert.deepEqual(pill, {
    x: 144,
    y: 4,
    width: 120,
    height: 38,
  });
});

test('computeMorphStretchMetrics detects horizontal, vertical, and stationary droplet moves', () => {
  const horiz = computeMorphStretchMetrics({ x: 10, y: 4 }, { x: 140, y: 4 });
  assert.equal(horiz.axis, 'horizontal');
  assert.equal(horiz.dx, 130);

  const vert = computeMorphStretchMetrics({ x: 8, y: 12 }, { x: 8, y: 112 });
  assert.equal(vert.axis, 'vertical');
  assert.equal(vert.dy, 100);

  const still = computeMorphStretchMetrics({ x: 8, y: 12 }, { x: 8.5, y: 12.5 });
  assert.equal(still.axis, 'none');
});

test('resolveActiveMotionLayerState promotes GPU layers only while active and respects reduced motion', () => {
  assert.equal(resolveActiveMotionLayerState({}), 'auto');
  assert.equal(
    resolveActiveMotionLayerState({ isAnimating: false, isMorphing: false, isDragging: false }),
    'auto'
  );
  assert.equal(
    resolveActiveMotionLayerState({ isAnimating: true, properties: 'transform, opacity' }),
    'transform, opacity'
  );
  assert.equal(resolveActiveMotionLayerState({ isMorphing: true }), 'transform');
  assert.equal(resolveActiveMotionLayerState({ isDragging: true }), 'transform');
  assert.equal(
    resolveActiveMotionLayerState({
      isAnimating: true,
      isMorphing: true,
      reducedMotion: true,
    }),
    'auto'
  );
});

test('resolveMorphActiveDurationMs returns positive release window only when moving or resizing', () => {
  assert.equal(resolveMorphActiveDurationMs(false), 0);
  assert.equal(resolveMorphActiveDurationMs(true), 420);
  assert.equal(resolveMorphActiveDurationMs(true, 380.4), 380);
});

test('computeMagneticPull bounds displacement around center cleanly', () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };
  assert.deepEqual(computeMagneticPull(200, 150, rect, 4), { tx: 0, ty: 0 });
  assert.deepEqual(computeMagneticPull(400, 300, rect, 4), { tx: 4, ty: 4 });
  assert.deepEqual(computeMagneticPull(0, 0, rect, 4), { tx: -4, ty: -4 });
  assert.deepEqual(computeMagneticPull(150, 125, { left: 0, top: 0, width: 0, height: 50 }), {
    tx: 0,
    ty: 0,
  });
});

test('computeRippleMetrics sizes expanding ripple to reach farthest corner of target box', () => {
  const rect = { left: 10, top: 20, width: 100, height: 40 };
  const centerRipple = computeRippleMetrics(60, 40, rect);
  assert.equal(centerRipple.localX, 50);
  assert.equal(centerRipple.localY, 20);
  assert.ok(centerRipple.diameter >= Math.ceil(Math.hypot(50, 20) * 2));

  const edgeRipple = computeRippleMetrics(10, 20, rect);
  assert.equal(edgeRipple.localX, 0);
  assert.equal(edgeRipple.localY, 0);
  assert.ok(edgeRipple.diameter >= Math.ceil(Math.hypot(100, 40) * 2));
});

test('resolveMotionProfileForTier preserves liquid fluid effects across tiers while keeping cards calm without 3D tilt', () => {
  const lite = resolveMotionProfileForTier('lite');
  assert.equal(lite.enableLiquidRipple, true);
  assert.equal(lite.enableMagneticPull, true);
  assert.equal(lite.enableSpotlightMove, true);
  assert.equal(lite.enableMorphStretch, true);
  assert.equal(lite.enable3DTilt, false);
  assert.equal(lite.maxTiltDeg, 0);
  assert.equal(lite.enableSharedMorph, true);
  assert.equal(lite.enableFluidSimulation, true);
  assert.ok(lite.fluidResolutionScale < 0.4);
  assert.ok(lite.fluidTargetFps <= 30);
  assert.equal(lite.rippleLimit, 1);
  assert.ok(!lite.pillTransition.includes('width'));

  const balanced = resolveMotionProfileForTier('balanced');
  assert.equal(balanced.enableLiquidRipple, true);
  assert.equal(balanced.enableMagneticPull, true);
  assert.equal(balanced.enableAuroraParallax, true);
  assert.equal(balanced.enable3DTilt, false);
  assert.ok(balanced.fluidResolutionScale < 0.6);

  const high = resolveMotionProfileForTier('high');
  assert.equal(high.enableLiquidRipple, true);
  assert.equal(high.enableMagneticPull, true);
  assert.equal(high.enableAuroraParallax, true);
  assert.equal(high.enable3DTilt, false);
  assert.equal(high.fluidResolutionScale, 1.0);
  assert.equal(high.fluidTargetFps, 60);
});

test('computeCardTiltAndSheen produces symmetric bounded 3D tilt angles and prism sheen coordinates', () => {
  const rect = { left: 100, top: 100, width: 400, height: 200 };
  const center = computeCardTiltAndSheen(300, 200, rect, 3.2);
  assert.equal(center.rotateXDeg, 0);
  assert.equal(center.rotateYDeg, 0);
  assert.equal(center.sheenXPercent, 50);

  const topRight = computeCardTiltAndSheen(500, 100, rect, 3.2);
  assert.equal(topRight.rotateXDeg, 3.2);
  assert.equal(topRight.rotateYDeg, 3.2);
  assert.equal(topRight.sheenXPercent, 100);
  assert.equal(topRight.sheenYPercent, 0);
});

test('computeSharedElementFlipTransform calculates clamped FLIP offset & scale ratios safely', () => {
  const origin = { left: 80, top: 40, width: 100, height: 40 };
  const target = { left: 320, top: 180, width: 500, height: 400 };
  const flip = computeSharedElementFlipTransform(origin, target);
  assert.equal(flip.valid, true);
  assert.equal(flip.dx, -440);
  assert.equal(flip.dy, -320);
  assert.ok(flip.scaleX >= 0.42 && flip.scaleX <= 1.25);
  assert.ok(flip.scaleY >= 0.42 && flip.scaleY <= 1.25);

  assert.equal(computeSharedElementFlipTransform(null, target).valid, false);
});

test('computeOptionStaggerDelayMs applies 30ms step with upper cap', () => {
  assert.equal(computeOptionStaggerDelayMs(0), 0);
  assert.equal(computeOptionStaggerDelayMs(1), 30);
  assert.equal(computeOptionStaggerDelayMs(4), 120);
  assert.equal(computeOptionStaggerDelayMs(8), 150);
});
