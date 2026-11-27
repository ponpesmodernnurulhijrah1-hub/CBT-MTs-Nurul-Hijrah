import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoudAlarmWavBytes, getProctorChimePattern } from './alarmAudio';

test('createLoudAlarmWavBytes generates a valid full-scale 0 dBFS 16-bit PCM WAV header & samples', () => {
  const sampleRate = 22050;
  const durationSec = 2;
  const wav = createLoudAlarmWavBytes(durationSec, sampleRate);

  // Header (44 bytes) + 2s * 22050 * 2 bytes
  assert.equal(wav.byteLength, 44 + durationSec * sampleRate * 2);

  const ascii = (start: number, len: number) =>
    String.fromCharCode(...wav.slice(start, start + len));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 4), 'WAVE');
  assert.equal(ascii(12, 4), 'fmt ');
  assert.equal(ascii(36, 4), 'data');

  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint16(20, true), 1); // PCM
  assert.equal(view.getUint16(22, true), 1); // Mono
  assert.equal(view.getUint32(24, true), sampleRate);
  assert.equal(view.getUint16(34, true), 16); // 16-bit

  // Verify peak amplitude reaches near full-scale (0 dBFS >= 30000) for maximum audibility at low volume
  let maxAbs = 0;
  for (let offset = 44; offset < wav.byteLength; offset += 2) {
    const sample = Math.abs(view.getInt16(offset, true));
    if (sample > maxAbs) maxAbs = sample;
  }
  assert.ok(maxAbs >= 30000, `Expected near full-scale peak >= 30000, got ${maxAbs}`);
});

test('getProctorChimePattern returns distinct multi-note sequences for teacher, violation, and face alerts', () => {
  const teacher = getProctorChimePattern('teacher');
  const violation = getProctorChimePattern('violation');
  const face = getProctorChimePattern('face');

  assert.equal(teacher.length, 4);
  assert.equal(violation.length, 3);
  assert.equal(face.length, 2);
  assert.ok(teacher.every((s) => s.freq > 0 && s.durationSec > 0 && s.gain > 0));
  assert.ok(teacher[0].delaySec < teacher[1].delaySec);
});
