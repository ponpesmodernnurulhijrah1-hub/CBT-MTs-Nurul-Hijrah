import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRelativeSpecularCoords,
  computeMorphIndicatorRect,
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
