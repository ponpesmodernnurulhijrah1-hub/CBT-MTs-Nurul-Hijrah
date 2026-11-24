import { useEffect, useState } from 'react';
import {
  deriveBatteryIndicatorState,
  type BatteryIndicatorState,
} from '../utils/batteryStatus';

interface BatteryManagerLike extends EventTarget {
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  level: number;
}

type NavigatorWithBattery = Navigator & {
  getBattery?: () => Promise<BatteryManagerLike>;
};

const INITIAL_UNSUPPORTED: BatteryIndicatorState = deriveBatteryIndicatorState({
  supported: false,
  level: null,
  charging: null,
});

/**
 * Subscribes to the live Web Battery Status API (`navigator.getBattery()`)
 * with zero polling and automatic listener cleanup on unmount.
 */
export function useBatteryStatus(): BatteryIndicatorState {
  const [batteryState, setBatteryState] = useState<BatteryIndicatorState>(INITIAL_UNSUPPORTED);

  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as NavigatorWithBattery;
    if (typeof nav.getBattery !== 'function') {
      setBatteryState(INITIAL_UNSUPPORTED);
      return;
    }

    let cancelled = false;
    let manager: BatteryManagerLike | null = null;

    const syncFromManager = () => {
      if (cancelled || !manager) return;
      setBatteryState(
        deriveBatteryIndicatorState({
          supported: true,
          level: manager.level,
          charging: manager.charging,
          chargingTime: manager.chargingTime,
          dischargingTime: manager.dischargingTime,
        })
      );
    };

    const events = [
      'chargingchange',
      'levelchange',
      'chargingtimechange',
      'dischargingtimechange',
    ] as const;

    nav
      .getBattery()
      .then((bat) => {
        if (cancelled) return;
        manager = bat;
        syncFromManager();
        events.forEach((ev) => bat.addEventListener(ev, syncFromManager));
      })
      .catch(() => {
        if (!cancelled) setBatteryState(INITIAL_UNSUPPORTED);
      });

    return () => {
      cancelled = true;
      if (manager) {
        events.forEach((ev) => manager?.removeEventListener(ev, syncFromManager));
      }
    };
  }, []);

  return batteryState;
}
