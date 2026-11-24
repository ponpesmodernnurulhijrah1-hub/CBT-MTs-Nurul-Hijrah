export type SlideDirection = 'forward' | 'backward' | 'none';

export interface BoxRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface MorphPillGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MorphStretchMetrics {
  dx: number;
  dy: number;
  distance: number;
  axis: 'horizontal' | 'vertical' | 'none';
}

export interface SpecularCoords {
  xPercent: number;
  yPercent: number;
}

/**
 * Resolves directional slide-in transition between ordered navigation tabs.
 */
export function resolveTabSlideDirection<T extends string>(
  tabs: readonly T[],
  prevTab: T | null | undefined,
  nextTab: T
): SlideDirection {
  if (!prevTab || prevTab === nextTab) return 'none';
  const prevIdx = tabs.indexOf(prevTab);
  const nextIdx = tabs.indexOf(nextTab);
  if (prevIdx === -1 || nextIdx === -1 || prevIdx === nextIdx) return 'none';
  return nextIdx > prevIdx ? 'forward' : 'backward';
}

/**
 * Resolves directional slide-in transition when navigating between exam questions.
 */
export function resolveQuestionSlideDirection(
  prevIndex: number,
  nextIndex: number
): SlideDirection {
  if (!Number.isFinite(prevIndex) || !Number.isFinite(nextIndex) || prevIndex === nextIndex) {
    return 'none';
  }
  return nextIndex > prevIndex ? 'forward' : 'backward';
}

/**
 * Clamps pointer coordinates relative to an element bounding box into 0..100 percentages
 * for GPU cursor-following specular highlights.
 */
export function clampRelativeSpecularCoords(
  clientX: number,
  clientY: number,
  rect: BoxRectLike
): SpecularCoords {
  if (!Number.isFinite(rect.width) || rect.width <= 0 || !Number.isFinite(rect.height) || rect.height <= 0) {
    return { xPercent: 50, yPercent: 50 };
  }
  const rawX = ((clientX - rect.left) / rect.width) * 100;
  const rawY = ((clientY - rect.top) / rect.height) * 100;
  const xPercent = Math.round(Math.min(100, Math.max(0, Number.isFinite(rawX) ? rawX : 50)) * 10) / 10;
  const yPercent = Math.round(Math.min(100, Math.max(0, Number.isFinite(rawY) ? rawY : 50)) * 10) / 10;
  return { xPercent, yPercent };
}

/**
 * Computes container-relative morphing pill geometry (supporting scroll offsets if DOM rects are used).
 */
export function computeMorphIndicatorRect(
  containerRect: { left: number; top: number; scrollLeft?: number; scrollTop?: number },
  itemRect: BoxRectLike
): MorphPillGeometry {
  const scrollLeft = Number.isFinite(containerRect.scrollLeft) ? Number(containerRect.scrollLeft) : 0;
  const scrollTop = Number.isFinite(containerRect.scrollTop) ? Number(containerRect.scrollTop) : 0;
  return {
    x: Math.round((itemRect.left - containerRect.left + scrollLeft) * 100) / 100,
    y: Math.round((itemRect.top - containerRect.top + scrollTop) * 100) / 100,
    width: Math.max(0, Math.round(itemRect.width * 100) / 100),
    height: Math.max(0, Math.round(itemRect.height * 100) / 100),
  };
}

/**
 * Computes droplet travel vector and primary axis so morphing Liquid Glass pills
 * know whether they are gliding horizontally (tabs) or vertically (sidebar rails).
 */
export function computeMorphStretchMetrics(
  prevGeom: Pick<MorphPillGeometry, 'x' | 'y'>,
  nextGeom: Pick<MorphPillGeometry, 'x' | 'y'>
): MorphStretchMetrics {
  const dx = Math.round((nextGeom.x - prevGeom.x) * 100) / 100;
  const dy = Math.round((nextGeom.y - prevGeom.y) * 100) / 100;
  const distance = Math.round(Math.hypot(dx, dy) * 100) / 100;
  if (distance < 2) {
    return { dx, dy, distance, axis: 'none' };
  }
  return {
    dx,
    dy,
    distance,
    axis: Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical',
  };
}

/**
 * Resolves compositor `will-change` policy so GPU layers are promoted ONLY
 * while an animation, morph glide, or pointer drag is actively executing,
 * then immediately released (`auto`) once idle to conserve mobile VRAM.
 */
export function resolveActiveMotionLayerState(params: {
  isAnimating?: boolean;
  isMorphing?: boolean;
  isDragging?: boolean;
  properties?: 'transform' | 'transform, opacity';
  reducedMotion?: boolean;
}): 'transform' | 'transform, opacity' | 'auto' {
  if (params.reducedMotion) return 'auto';
  if (params.isAnimating || params.isMorphing || params.isDragging) {
    return params.properties ?? 'transform';
  }
  return 'auto';
}

/**
 * Computes active compositor release delay (ms) matching the CSS spring curve
 * so temporary `will-change` promotion tears down cleanly right after settling.
 */
export function resolveMorphActiveDurationMs(
  hasPositionOrSizeChange: boolean,
  baseDurationMs = 420
): number {
  if (!hasPositionOrSizeChange || !Number.isFinite(baseDurationMs) || baseDurationMs <= 0) {
    return 0;
  }
  return Math.round(baseDurationMs);
}

/**
 * Computes bounded GPU magnetic attraction displacement (`px`) for desktop hover
 * around an element's center so interactive glass cards feel responsive without layout shift.
 */
export function computeMagneticPull(
  clientX: number,
  clientY: number,
  rect: BoxRectLike,
  maxPullPx = 3.5
): { tx: number; ty: number } {
  if (
    !Number.isFinite(rect.width) ||
    rect.width <= 0 ||
    !Number.isFinite(rect.height) ||
    rect.height <= 0 ||
    !Number.isFinite(maxPullPx) ||
    maxPullPx <= 0
  ) {
    return { tx: 0, ty: 0 };
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const nx = Math.min(1, Math.max(-1, (clientX - cx) / (rect.width / 2)));
  const ny = Math.min(1, Math.max(-1, (clientY - cy) / (rect.height / 2)));
  return {
    tx: Math.round((Number.isFinite(nx) ? nx * maxPullPx : 0) * 100) / 100,
    ty: Math.round((Number.isFinite(ny) ? ny * maxPullPx : 0) * 100) / 100,
  };
}

/**
 * Computes expanding liquid ripple diameter and local center coordinates
 * guaranteed to cover the farthest corner of the pressed glass surface.
 */
export function computeRippleMetrics(
  clientX: number,
  clientY: number,
  rect: BoxRectLike
): { localX: number; localY: number; diameter: number } {
  const w = Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 0;
  const h = Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 0;
  const localX = Math.min(w, Math.max(0, Number.isFinite(clientX - rect.left) ? clientX - rect.left : w / 2));
  const localY = Math.min(h, Math.max(0, Number.isFinite(clientY - rect.top) ? clientY - rect.top : h / 2));
  const maxDistX = Math.max(localX, w - localX);
  const maxDistY = Math.max(localY, h - localY);
  const radius = Math.hypot(maxDistX, maxDistY);
  return {
    localX: Math.round(localX * 10) / 10,
    localY: Math.round(localY * 10) / 10,
    diameter: Math.max(24, Math.ceil(radius * 2)),
  };
}

export interface MotionTierProfile {
  enableSpotlightMove: boolean;
  enableMagneticPull: boolean;
  enableLiquidRipple: boolean;
  enableAuroraParallax: boolean;
  enableMorphStretch: boolean;
  enable3DTilt: boolean;
  enableSharedMorph: boolean;
  enableFluidSimulation: boolean;
  maxTiltDeg: number;
  fluidResolutionScale: number;
  fluidTargetFps: number;
  rippleLimit: number;
  morphDurationMs: number;
  sharedMorphDurationMs: number;
  pillTransition: string;
}

/**
 * Returns device-adaptive fluid transition parameters:
 * ALL 3D, fluid, tilt, sheen, ripple, magnetic, and morph effects remain active
 * across every tier — mobile tiers (`balanced`, `lite`) scale pixel fill-rate,
 * frame pacing, and GPU-composited curve duration rather than dropping effects.
 */
export function resolveMotionProfileForTier(
  tier: 'high' | 'balanced' | 'lite'
): MotionTierProfile {
  if (tier === 'lite') {
    return {
      enableSpotlightMove: true,
      enableMagneticPull: true,
      enableLiquidRipple: true,
      enableAuroraParallax: true,
      enableMorphStretch: true,
      enable3DTilt: true,
      enableSharedMorph: true,
      enableFluidSimulation: true,
      maxTiltDeg: 1.9,
      fluidResolutionScale: 0.28,
      fluidTargetFps: 30,
      rippleLimit: 1,
      morphDurationMs: 260,
      sharedMorphDurationMs: 250,
      pillTransition:
        'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms cubic-bezier(0.22, 1, 0.36, 1)',
    };
  }
  if (tier === 'balanced') {
    return {
      enableSpotlightMove: true,
      enableMagneticPull: true,
      enableLiquidRipple: true,
      enableAuroraParallax: true,
      enableMorphStretch: true,
      enable3DTilt: true,
      enableSharedMorph: true,
      enableFluidSimulation: true,
      maxTiltDeg: 2.4,
      fluidResolutionScale: 0.45,
      fluidTargetFps: 40,
      rippleLimit: 2,
      morphDurationMs: 330,
      sharedMorphDurationMs: 310,
      pillTransition:
        'transform 330ms cubic-bezier(0.22, 1, 0.36, 1), width 300ms cubic-bezier(0.16, 1, 0.3, 1), height 300ms cubic-bezier(0.16, 1, 0.3, 1), opacity 180ms ease',
    };
  }
  return {
    enableSpotlightMove: true,
    enableMagneticPull: true,
    enableLiquidRipple: true,
    enableAuroraParallax: true,
    enableMorphStretch: true,
    enable3DTilt: true,
    enableSharedMorph: true,
    enableFluidSimulation: true,
    maxTiltDeg: 3.0,
    fluidResolutionScale: 1.0,
    fluidTargetFps: 60,
    rippleLimit: 2,
    morphDurationMs: 420,
    sharedMorphDurationMs: 380,
    pillTransition:
      'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), width 380ms cubic-bezier(0.16, 1, 0.3, 1), height 380ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
  };
}

export interface CardTiltAndSheen {
  rotateXDeg: number;
  rotateYDeg: number;
  sheenXPercent: number;
  sheenYPercent: number;
  sheenAngleDeg: number;
}

/**
 * Computes subtle 3D optical tilt (deg) and holographic prism sheen angle from pointer coordinates.
 */
export function computeCardTiltAndSheen(
  clientX: number,
  clientY: number,
  rect: BoxRectLike,
  maxTiltDeg = 3.2
): CardTiltAndSheen {
  if (
    !Number.isFinite(rect.width) ||
    rect.width <= 0 ||
    !Number.isFinite(rect.height) ||
    rect.height <= 0 ||
    !Number.isFinite(maxTiltDeg) ||
    maxTiltDeg <= 0
  ) {
    return {
      rotateXDeg: 0,
      rotateYDeg: 0,
      sheenXPercent: 50,
      sheenYPercent: 50,
      sheenAngleDeg: 125,
    };
  }

  const nx = Math.min(1, Math.max(-1, (clientX - (rect.left + rect.width / 2)) / (rect.width / 2)));
  const ny = Math.min(1, Math.max(-1, (clientY - (rect.top + rect.height / 2)) / (rect.height / 2)));
  const rotateXDeg = Math.round((-ny * maxTiltDeg) * 100) / 100 || 0;
  const rotateYDeg = Math.round((nx * maxTiltDeg) * 100) / 100 || 0;
  const sheenXPercent = Math.round(((nx + 1) * 50) * 10) / 10;
  const sheenYPercent = Math.round(((ny + 1) * 50) * 10) / 10;
  const sheenAngleDeg = Math.round((125 + nx * 28 - ny * 18) * 10) / 10;

  return {
    rotateXDeg,
    rotateYDeg,
    sheenXPercent,
    sheenYPercent,
    sheenAngleDeg,
  };
}

export interface SharedElementFlipTransform {
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  valid: boolean;
}

/**
 * Computes bounded FLIP (First-Last-Invert-Play) transform so modals and portal/exam views
 * morph cleanly out of their triggering button or card without aspect distortion.
 */
export function computeSharedElementFlipTransform(
  originRect: BoxRectLike | null | undefined,
  targetRect: BoxRectLike | null | undefined
): SharedElementFlipTransform {
  if (
    !originRect ||
    !targetRect ||
    !Number.isFinite(originRect.width) ||
    !Number.isFinite(originRect.height) ||
    !Number.isFinite(targetRect.width) ||
    !Number.isFinite(targetRect.height) ||
    originRect.width <= 4 ||
    originRect.height <= 4 ||
    targetRect.width <= 16 ||
    targetRect.height <= 16
  ) {
    return { dx: 0, dy: 0, scaleX: 1, scaleY: 1, valid: false };
  }

  const originCx = originRect.left + originRect.width / 2;
  const originCy = originRect.top + originRect.height / 2;
  const targetCx = targetRect.left + targetRect.width / 2;
  const targetCy = targetRect.top + targetRect.height / 2;

  const dx = Math.round((originCx - targetCx) * 100) / 100;
  const dy = Math.round((originCy - targetCy) * 100) / 100;
  const rawScaleX = originRect.width / targetRect.width;
  const rawScaleY = originRect.height / targetRect.height;

  // Bound extreme ratios so narrow pill buttons expand gracefully into wide modals
  const scaleX = Math.round(Math.min(1.25, Math.max(0.42, rawScaleX)) * 1000) / 1000;
  const scaleY = Math.round(Math.min(1.25, Math.max(0.42, rawScaleY)) * 1000) / 1000;

  return {
    dx,
    dy,
    scaleX,
    scaleY,
    valid: Number.isFinite(dx) && Number.isFinite(dy),
  };
}

/**
 * Computes bounded 30ms stagger delay for exam answer options A..E during Liquid Card Flow.
 */
export function computeOptionStaggerDelayMs(
  index: number,
  stepMs = 30,
  maxDelayMs = 150
): number {
  if (!Number.isFinite(index) || index < 0) return 0;
  return Math.min(maxDelayMs, Math.round(index) * stepMs);
}

