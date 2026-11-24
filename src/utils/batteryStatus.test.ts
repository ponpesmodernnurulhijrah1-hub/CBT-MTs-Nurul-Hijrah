import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveBatteryIndicatorState,
  formatBatteryDurationSeconds,
} from './batteryStatus';

test('formatBatteryDurationSeconds formats minutes and hours cleanly while ignoring Infinity/invalid values', () => {
  assert.equal(formatBatteryDurationSeconds(Infinity), null);
  assert.equal(formatBatteryDurationSeconds(NaN), null);
  assert.equal(formatBatteryDurationSeconds(0), null);
  assert.equal(formatBatteryDurationSeconds(25), '< 1 mnt');
  assert.equal(formatBatteryDurationSeconds(1800), '30 mnt');
  assert.equal(formatBatteryDurationSeconds(7200), '2 jam');
  assert.equal(formatBatteryDurationSeconds(5100), '1j 25m');
});

test('deriveBatteryIndicatorState handles unsupported browsers without fabricating percentages', () => {
  const state = deriveBatteryIndicatorState({
    supported: false,
    level: null,
    charging: null,
  });

  assert.equal(state.supported, false);
  assert.equal(state.percentage, null);
  assert.equal(state.severity, 'unknown');
  assert.equal(state.shortLabel, 'N/A');
});

test('deriveBatteryIndicatorState classifies charging, healthy, medium, and low thresholds accurately', () => {
  const chargingLow = deriveBatteryIndicatorState({
    supported: true,
    level: 0.14,
    charging: true,
    chargingTime: 2400,
  });
  assert.equal(chargingLow.percentage, 14);
  assert.equal(chargingLow.charging, true);
  assert.equal(chargingLow.severity, 'charging');
  assert.match(chargingLow.tooltip, /Mengisi daya/);
  assert.match(chargingLow.tooltip, /40 mnt/);

  const low = deriveBatteryIndicatorState({
    supported: true,
    level: 0.18,
    charging: false,
    dischargingTime: 1500,
  });
  assert.equal(low.severity, 'low');
  assert.equal(low.shortLabel, '18%');
  assert.match(low.tooltip, /Daya rendah/);

  const medium = deriveBatteryIndicatorState({
    supported: true,
    level: 0.35,
    charging: false,
  });
  assert.equal(medium.severity, 'medium');

  const healthy = deriveBatteryIndicatorState({
    supported: true,
    level: 0.874,
    charging: false,
  });
  assert.equal(healthy.percentage, 87);
  assert.equal(healthy.severity, 'healthy');
});
