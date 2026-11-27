// Hybrid HTML5 <audio> + Web Audio API high-presence emergency alarm system.
// Uses a full-scale (0 dBFS) 1.2kHz–3.4kHz harmonic WAV <audio loop> element PLUS a 3-oscillator
// Web Audio DynamicsCompressor siren so the alarm stays loud, piercing, and persistent across
// background app switches and low device volumes.

interface ActiveSirenBundle {
  oscs: OscillatorNode[];
  masterGain: GainNode;
  compressor: DynamicsCompressorNode;
  intervalId: number;
  timeoutId: number | null;
}

let sharedAudioCtx: AudioContext | null = null;
let activeSirenNodes: ActiveSirenBundle | null = null;
let registeredAudioEl: HTMLAudioElement | null = null;
let cachedAlarmWavUrl: string | null = null;
let alarmEnforceIntervalId: number | null = null;
let alarmActiveFlag = false;

/**
 * Generate a full-scale (0 dBFS) 16-bit mono PCM WAV buffer targeting 1.2kHz–3.4kHz
 * (peak human hearing & mobile speaker sensitivity so it remains clearly audible even at low volume).
 */
export function createLoudAlarmWavBytes(durationSec = 2, sampleRate = 22050): Uint8Array {
  const numSamples = Math.max(1, Math.floor(durationSec * sampleRate));
  const dataByteLength = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataByteLength);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, 'WAVE');
  // fmt chunk
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1 (Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  // data chunk
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Rapid 5 Hz alternating harsh multi-tone emergency klaxon in 1.2kHz–3.4kHz sensitivity band
    const phase = Math.floor(t * 5) % 2;
    const f1 = phase === 0 ? 1240 : 1680;
    const f2 = phase === 0 ? 1860 : 2490;
    const f3 = phase === 0 ? 2790 : 3320;

    // Combine square/harsh harmonics and hard-clip for maximum RMS loudness (~0 dBFS)
    const w1 = Math.sin(2 * Math.PI * f1 * t) >= 0 ? 0.55 : -0.55;
    const w2 = Math.sin(2 * Math.PI * f2 * t) >= 0 ? 0.45 : -0.45;
    const w3 = Math.sin(2 * Math.PI * f3 * t) >= 0 ? 0.35 : -0.35;
    const combined = Math.max(-1, Math.min(1, (w1 + w2 + w3) * 1.35));

    view.setInt16(44 + i * 2, Math.round(combined * 32760), true);
  }

  return new Uint8Array(buffer);
}

export function getLoudAlarmAudioSrc(): string {
  if (cachedAlarmWavUrl) return cachedAlarmWavUrl;
  const bytes = createLoudAlarmWavBytes(2, 22050);
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    cachedAlarmWavUrl = URL.createObjectURL(blob);
    return cachedAlarmWavUrl;
  }
  // Fallback base64 data URI
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  cachedAlarmWavUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return cachedAlarmWavUrl;
}

export function registerAlarmAudioElement(el: HTMLAudioElement | null): void {
  registeredAudioEl = el;
  if (el) {
    el.loop = true;
    el.volume = 1.0;
    el.muted = false;
  }
}

export function isLoudAlarmPlaying(): boolean {
  return alarmActiveFlag;
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export async function unlockAlarmAudio(): Promise<boolean> {
  let unlockedAny = false;

  // 1. Unlock HTML5 <audio> element inside user gesture ("Mulai Ujian")
  if (registeredAudioEl) {
    try {
      registeredAudioEl.muted = true;
      registeredAudioEl.volume = 1.0;
      const playPromise = registeredAudioEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        await playPromise;
      }
      registeredAudioEl.pause();
      registeredAudioEl.currentTime = 0;
      registeredAudioEl.muted = false;
      unlockedAny = true;
    } catch {
      registeredAudioEl.muted = false;
    }
  }

  // 2. Unlock Web AudioContext
  const ctx = getAudioContext();
  if (ctx) {
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.02);
      unlockedAny = true;
    } catch {
      // Ignore
    }
  }

  return unlockedAny;
}

export function stopLoudSiren(): void {
  alarmActiveFlag = false;

  if (alarmEnforceIntervalId !== null) {
    window.clearInterval(alarmEnforceIntervalId);
    alarmEnforceIntervalId = null;
  }

  if (registeredAudioEl) {
    try {
      registeredAudioEl.pause();
      registeredAudioEl.currentTime = 0;
    } catch {
      // Ignore
    }
  }

  if (activeSirenNodes) {
    window.clearInterval(activeSirenNodes.intervalId);
    if (activeSirenNodes.timeoutId !== null) {
      window.clearTimeout(activeSirenNodes.timeoutId);
    }
    for (const osc of activeSirenNodes.oscs) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Ignore already-stopped nodes
      }
    }
    try {
      activeSirenNodes.masterGain.disconnect();
      activeSirenNodes.compressor.disconnect();
    } catch {
      // Ignore
    }
    activeSirenNodes = null;
  }
}

/**
 * Bunyikan sirine alarm SANGAT KERAS & PERSISTEN via elemen <audio> + Web Audio API Compressor.
 * @param durationMs Lama sirine berbunyi dalam ms (0 = terus berbunyi sampai dimatikan via stopLoudSiren)
 */
export function playLoudSiren(durationMs = 0): void {
  stopLoudSiren();
  alarmActiveFlag = true;

  // Channel 1: HTML5 <audio loop> at max volume (survives background throttling & low system volume)
  if (registeredAudioEl) {
    try {
      registeredAudioEl.loop = true;
      registeredAudioEl.muted = false;
      registeredAudioEl.volume = 1.0;
      if (registeredAudioEl.paused) {
        registeredAudioEl.currentTime = 0;
      }
      registeredAudioEl.play().catch(() => {});
    } catch {
      // Ignore
    }

    // Re-assert max volume and playback if browser pauses or lowers volume unexpectedly
    alarmEnforceIntervalId = window.setInterval(() => {
      if (!alarmActiveFlag || !registeredAudioEl) return;
      try {
        registeredAudioEl.muted = false;
        registeredAudioEl.volume = 1.0;
        if (registeredAudioEl.paused) {
          registeredAudioEl.play().catch(() => {});
        }
      } catch {
        // Ignore
      }
    }, 500);
  }

  // Channel 2: Web Audio API 3-oscillator dissonant siren + DynamicsCompressor boost
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  try {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-16, ctx.currentTime);
    compressor.knee.setValueAtTime(8, ctx.currentTime);
    compressor.ratio.setValueAtTime(16, ctx.currentTime);
    compressor.attack.setValueAtTime(0.001, ctx.currentTime);
    compressor.release.setValueAtTime(0.08, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(1.0, ctx.currentTime);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const osc3 = ctx.createOscillator();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc3.type = 'sawtooth';

    osc1.frequency.setValueAtTime(1180, ctx.currentTime);
    osc2.frequency.setValueAtTime(1740, ctx.currentTime);
    osc3.frequency.setValueAtTime(2580, ctx.currentTime);

    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    const g3 = ctx.createGain();
    g1.gain.value = 0.5;
    g2.gain.value = 0.45;
    g3.gain.value = 0.4;

    osc1.connect(g1);
    osc2.connect(g2);
    osc3.connect(g3);
    g1.connect(masterGain);
    g2.connect(masterGain);
    g3.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    osc1.start();
    osc2.start();
    osc3.start();

    let step = 0;
    const intervalId = window.setInterval(() => {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      step = (step + 1) % 3;
      const now = ctx.currentTime;
      if (step === 0) {
        osc1.frequency.setValueAtTime(1240, now);
        osc2.frequency.setValueAtTime(1860, now);
        osc3.frequency.setValueAtTime(2790, now);
      } else if (step === 1) {
        osc1.frequency.setValueAtTime(880, now);
        osc2.frequency.setValueAtTime(1320, now);
        osc3.frequency.setValueAtTime(1980, now);
      } else {
        osc1.frequency.setValueAtTime(1480, now);
        osc2.frequency.setValueAtTime(2210, now);
        osc3.frequency.setValueAtTime(3280, now);
      }
    }, 130);

    const timeoutId =
      durationMs > 0
        ? window.setTimeout(() => {
            stopLoudSiren();
          }, durationMs)
        : null;

    activeSirenNodes = {
      oscs: [osc1, osc2, osc3],
      masterGain,
      compressor,
      intervalId,
      timeoutId,
    };
  } catch {
    // Ignore audio context block in headless environment
  }
}

export function playWarningBeep(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1040, ctx.currentTime);
    gain.gain.setValueAtTime(0.65, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // Ignore already disconnected nodes
      }
    };
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch {
    // Ignore
  }
}

export type ProctorChimeKind = 'teacher' | 'violation' | 'face';

export interface ChimeToneStep {
  freq: number;
  delaySec: number;
  durationSec: number;
  gain: number;
  type: OscillatorType;
}

export function getProctorChimePattern(kind: ProctorChimeKind): ChimeToneStep[] {
  if (kind === 'teacher') {
    return [
      { freq: 880, delaySec: 0, durationSec: 0.14, gain: 0.42, type: 'triangle' },
      { freq: 1318, delaySec: 0.12, durationSec: 0.18, gain: 0.48, type: 'triangle' },
      { freq: 1046, delaySec: 0.34, durationSec: 0.14, gain: 0.45, type: 'triangle' },
      { freq: 1568, delaySec: 0.46, durationSec: 0.24, gain: 0.5, type: 'triangle' },
    ];
  }
  if (kind === 'violation') {
    return [
      { freq: 988, delaySec: 0, durationSec: 0.18, gain: 0.48, type: 'sawtooth' },
      { freq: 740, delaySec: 0.19, durationSec: 0.22, gain: 0.44, type: 'triangle' },
      { freq: 988, delaySec: 0.42, durationSec: 0.22, gain: 0.48, type: 'triangle' },
    ];
  }
  return [
    { freq: 784, delaySec: 0, durationSec: 0.14, gain: 0.36, type: 'sine' },
    { freq: 1046, delaySec: 0.15, durationSec: 0.2, gain: 0.4, type: 'triangle' },
  ];
}

/**
 * Plays a distinct, clear proctoring notification chime for VirtualPetAssistant
 * so students immediately notice incoming teacher warnings or camera/proctoring alerts.
 */
export function playProctorNotificationChime(kind: ProctorChimeKind = 'teacher'): boolean {
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }

  try {
    const baseTime = ctx.currentTime;
    const steps = getProctorChimePattern(kind);
    for (const step of steps) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startAt = baseTime + step.delaySec;
      const stopAt = startAt + step.durationSec;

      osc.type = step.type;
      osc.frequency.setValueAtTime(step.freq, startAt);

      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.linearRampToValueAtTime(step.gain, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.005, stopAt);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          // Ignore
        }
      };

      osc.start(startAt);
      osc.stop(stopAt + 0.01);
    }
    return true;
  } catch {
    return false;
  }
}
