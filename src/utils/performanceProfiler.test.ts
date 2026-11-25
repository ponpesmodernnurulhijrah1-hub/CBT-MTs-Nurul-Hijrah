import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateFpsProfilerWindow,
  mapDeviceTierToProfilerLevel,
  mapProfilerLevelToPerfTier,
  resolveProfilerFilterSettings,
  type FpsProfilerState,
} from './performanceProfiler';

test('resolveProfilerFilterSettings lowers CSS blur radius and disables particles on low tier while preserving ultra fidelity', () => {
  const ultra = resolveProfilerFilterSettings('ultra');
  assert.equal(ultra.blurRadiusPx, 40);
  assert.equal(ultra.saturatePercent, 240);
  assert.equal(ultra.particlesEnabled, true);
  assert.equal(ultra.svgRefractEnabled, true);

  const balanced = resolveProfilerFilterSettings('balanced');
  assert.ok(balanced.blurRadiusPx < ultra.blurRadiusPx);
  assert.equal(balanced.particlesEnabled, true);
  assert.equal(balanced.svgRefractEnabled, false);

  const low = resolveProfilerFilterSettings('low');
  assert.ok(low.blurRadiusPx <= 8);
  assert.ok(low.saturatePercent < balanced.saturatePercent);
  assert.equal(low.particlesEnabled, false);
  assert.equal(low.svgRefractEnabled, false);
});

test('evaluateFpsProfilerWindow steps down on sustained low FPS and recovers safely within ceiling', () => {
  let state: FpsProfilerState = {
    level: 'ultra',
    lowStreak: 0,
    highStreak: 0,
    lastMeasuredFps: 60,
  };

  // Single mild dip does not immediately downgrade
  let res = evaluateFpsProfilerWindow(state, 40, 'ultra');
  assert.equal(res.changed, false);
  assert.equal(res.nextState.level, 'ultra');
  state = res.nextState;

  // Second consecutive dip triggers step down ultra -> balanced
  res = evaluateFpsProfilerWindow(state, 39, 'ultra');
  assert.equal(res.changed, true);
  assert.equal(res.nextState.level, 'balanced');
  state = res.nextState;

  // Severe frame stall immediately drops balanced -> low
  res = evaluateFpsProfilerWindow(state, 18, 'ultra');
  assert.equal(res.changed, true);
  assert.equal(res.nextState.level, 'low');
  state = res.nextState;

  // Sustained recovery restores low -> balanced when ceiling permits
  for (let i = 0; i < 3; i += 1) {
    res = evaluateFpsProfilerWindow(state, 52, 'ultra');
    assert.equal(res.changed, false);
    state = res.nextState;
  }
  res = evaluateFpsProfilerWindow(state, 54, 'ultra');
  assert.equal(res.changed, true);
  assert.equal(res.nextState.level, 'balanced');
});

test('evaluateFpsProfilerWindow respects hardware maxCeilingLevel and invalid FPS readings', () => {
  const lowState: FpsProfilerState = {
    level: 'low',
    lowStreak: 0,
    highStreak: 3,
    lastMeasuredFps: 50,
  };
  const capped = evaluateFpsProfilerWindow(lowState, 58, 'low');
  assert.equal(capped.changed, false);
  assert.equal(capped.nextState.level, 'low');

  const ignored = evaluateFpsProfilerWindow(lowState, Number.NaN, 'ultra');
  assert.equal(ignored.changed, false);
  assert.equal(ignored.nextState, lowState);

  assert.equal(mapDeviceTierToProfilerLevel('high'), 'ultra');
  assert.equal(mapDeviceTierToProfilerLevel('balanced'), 'balanced');
  assert.equal(mapDeviceTierToProfilerLevel('lite'), 'low');
  assert.equal(mapProfilerLevelToPerfTier('low'), 'lite');
  assert.equal(mapProfilerLevelToPerfTier('ultra'), 'high');
});
