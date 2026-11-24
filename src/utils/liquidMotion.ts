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

