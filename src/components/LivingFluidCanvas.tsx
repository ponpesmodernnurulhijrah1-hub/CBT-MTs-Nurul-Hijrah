import React, { useEffect, useRef } from 'react';
import type { DevicePerfTier } from '../utils/deviceViewport';

interface LivingFluidCanvasProps {
  zenFocus?: boolean;
}

const VERTEX_SHADER_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
varying vec2 v_uv;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_pointer;
uniform vec2 u_pointerVel;
uniform float u_impulse;
uniform float u_zen;
uniform float u_quality;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbmFluid(vec2 p, float octaves) {
  float val = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    if (float(i) >= octaves) break;
    val += amp * noise(p);
    p = rot * p * 1.95 + vec2(1.7, 3.2);
    amp *= 0.5;
  }
  return val;
}

void main() {
  float aspect = u_resolution.x / max(1.0, u_resolution.y);
  vec2 uv = v_uv;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0) * 2.15;

  // Interactive pointer vortex & luminous wave disturbance
  vec2 ptr = (u_pointer - 0.5) * vec2(aspect, 1.0) * 2.15;
  vec2 delta = p - ptr;
  float dist = length(delta);
  float waveRing = sin(dist * 9.5 - u_time * 3.8) * exp(-dist * 2.8) * u_impulse;
  vec2 swirl = vec2(-delta.y, delta.x) * exp(-dist * 2.2) * (0.28 + u_impulse * 0.65);
  p += swirl + u_pointerVel * exp(-dist * 1.8) * 0.45 + normalize(delta + 0.0001) * waveRing * 0.14;

  float t = u_time * 0.22;
  vec2 q = vec2(
    fbmFluid(p + vec2(t * 0.7, -t * 0.5), u_quality),
    fbmFluid(p + vec2(-t * 0.6, t * 0.8) + vec2(4.2, 1.9), u_quality)
  );
  float f = fbmFluid(p + 1.85 * q + vec2(t * 0.35, -t * 0.25), u_quality);

  // Iridescent Quantum Crystal Nebula Palette: Pearl White, Crystal Blue, Cyan, Aurora Violet
  vec3 pearl = vec3(0.955, 0.972, 1.000);
  vec3 crystalBlue = vec3(0.240, 0.510, 0.975);
  vec3 cyanGlow = vec3(0.110, 0.815, 0.925);
  vec3 auroraViolet = vec3(0.560, 0.380, 0.960);

  vec3 col = mix(pearl, crystalBlue, smoothstep(0.18, 0.72, f));
  col = mix(col, cyanGlow, smoothstep(0.26, 0.82, q.x) * 0.78);
  col = mix(col, auroraViolet, smoothstep(0.32, 0.86, q.y) * 0.58);

  // Specular caustics ribbon along liquid crests
  float caustic = pow(clamp(1.0 - abs(f - 0.52) * 4.2, 0.0, 1.0), 2.4);
  col += vec3(0.85, 0.96, 1.0) * caustic * 0.28;

  // Soft radiant pointer aura behind glass cards
  float cursorGlow = exp(-dist * 2.35) * (0.14 + u_impulse * 0.26);
  col += mix(cyanGlow, pearl, 0.55) * cursorGlow;

  // Gentle vignette keeping top pearl-bright & luminous
  col = mix(col, pearl, 0.24);

  // Zen Focus Mode during active CBT exam: softens contrast & dims ambient luminescence
  vec3 zenTint = vec3(0.915, 0.942, 0.975);
  col = mix(col, zenTint, clamp(u_zen, 0.0, 1.0) * 0.58);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compileWebGLShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function isSoftwareWebGLRenderer(gl: WebGLRenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(
      (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) || ''
    ).toLowerCase();
    return (
      renderer.includes('swiftshader') ||
      renderer.includes('llvmpipe') ||
      renderer.includes('software') ||
      renderer.includes('mesa offscreen') ||
      renderer.includes('microsoft basic render')
    );
  } catch {
    return false;
  }
}

function readTier(): DevicePerfTier {
  if (typeof document === 'undefined') return 'high';
  const raw = document.documentElement.dataset.perfTier;
  if (raw === 'lite' || raw === 'balanced' || raw === 'high') return raw;
  return 'high';
}

export const LivingFluidCanvas: React.FC<LivingFluidCanvasProps> = ({ zenFocus = false }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const zenTargetRef = useRef(zenFocus ? 1 : 0);
  const onZenChangeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    zenTargetRef.current = zenFocus ? 1 : 0;
    onZenChangeRef.current?.();
  }, [zenFocus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;

    const prefersReduced = Boolean(
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    );

    let activeTier: DevicePerfTier = readTier();
    let rafId: number | null = null;
    let isDisposed = false;
    let isTabHidden = document.hidden;

    // Interactive pointer state
    const pointer = { x: 0.5, y: 0.35, targetX: 0.5, targetY: 0.35, vx: 0, vy: 0, impulse: 0 };
    let simTime = 12.4;
    let zenCurrent = zenTargetRef.current;
    let lastFrameMs = performance.now();

    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let uTimeLoc: WebGLUniformLocation | null = null;
    let uResLoc: WebGLUniformLocation | null = null;
    let uPtrLoc: WebGLUniformLocation | null = null;
    let uVelLoc: WebGLUniformLocation | null = null;
    let uImpulseLoc: WebGLUniformLocation | null = null;
    let uZenLoc: WebGLUniformLocation | null = null;
    let uQualityLoc: WebGLUniformLocation | null = null;
    let ctx2d: CanvasRenderingContext2D | null = null;

    const initContext = () => {
      try {
        const probeCanvas = document.createElement('canvas');
        const probeGl =
          (probeCanvas.getContext('webgl') as WebGLRenderingContext | null) ||
          (probeCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null);
        const useHardwareWebGl = Boolean(probeGl && !isSoftwareWebGLRenderer(probeGl));
        probeGl?.getExtension('WEBGL_lose_context')?.loseContext();

        const createdGl = useHardwareWebGl
          ? ((canvas.getContext('webgl', {
              alpha: false,
              antialias: false,
              depth: false,
              stencil: false,
              powerPreference: activeTier === 'lite' ? 'low-power' : 'default',
              preserveDrawingBuffer: false,
            }) as WebGLRenderingContext | null) ||
            (canvas.getContext('experimental-webgl', {
              preserveDrawingBuffer: false,
            }) as WebGLRenderingContext | null))
          : null;

        if (createdGl) {
          createdGl.clearColor(0.955, 0.972, 1.0, 1.0);
          createdGl.clear(createdGl.COLOR_BUFFER_BIT);
          const vs = compileWebGLShader(createdGl, createdGl.VERTEX_SHADER, VERTEX_SHADER_SRC);
          const fs = compileWebGLShader(createdGl, createdGl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);
          if (vs && fs) {
            const prog = createdGl.createProgram();
            if (prog) {
              createdGl.attachShader(prog, vs);
              createdGl.attachShader(prog, fs);
              createdGl.linkProgram(prog);
              createdGl.deleteShader(vs);
              createdGl.deleteShader(fs);
              if (createdGl.getProgramParameter(prog, createdGl.LINK_STATUS)) {
                const buf = createdGl.createBuffer();
                createdGl.bindBuffer(createdGl.ARRAY_BUFFER, buf);
                createdGl.bufferData(
                  createdGl.ARRAY_BUFFER,
                  new Float32Array([-1, -1, 3, -1, -1, 3]),
                  createdGl.STATIC_DRAW
                );
                const posLoc = createdGl.getAttribLocation(prog, 'a_pos');
                createdGl.enableVertexAttribArray(posLoc);
                createdGl.vertexAttribPointer(posLoc, 2, createdGl.FLOAT, false, 0, 0);

                gl = createdGl;
                program = prog;
                buffer = buf;
                uTimeLoc = createdGl.getUniformLocation(prog, 'u_time');
                uResLoc = createdGl.getUniformLocation(prog, 'u_resolution');
                uPtrLoc = createdGl.getUniformLocation(prog, 'u_pointer');
                uVelLoc = createdGl.getUniformLocation(prog, 'u_pointerVel');
                uImpulseLoc = createdGl.getUniformLocation(prog, 'u_impulse');
                uZenLoc = createdGl.getUniformLocation(prog, 'u_zen');
                uQualityLoc = createdGl.getUniformLocation(prog, 'u_quality');
                return;
              }
              createdGl.deleteProgram(prog);
            }
          } else {
            if (vs) createdGl.deleteShader(vs);
            if (fs) createdGl.deleteShader(fs);
          }
        }
      } catch {
        // Fall through cleanly to 2D Canvas renderer
      }

      ctx2d = canvas.getContext('2d', { alpha: false });
    };

    const drawFrame = (dtSec: number) => {
      if (isDisposed) return;

      const zenTarget = zenTargetRef.current;
      zenCurrent += (zenTarget - zenCurrent) * Math.min(1, dtSec * 4.5);

      const speedMul = 1 - zenCurrent * 0.62;
      simTime += dtSec * speedMul;

      const prevX = pointer.x;
      const prevY = pointer.y;
      pointer.x += (pointer.targetX - pointer.x) * Math.min(1, dtSec * 8);
      pointer.y += (pointer.targetY - pointer.y) * Math.min(1, dtSec * 8);
      pointer.vx = Math.max(-1.5, Math.min(1.5, (pointer.x - prevX) * 18));
      pointer.vy = Math.max(-1.5, Math.min(1.5, (pointer.y - prevY) * 18));
      pointer.impulse *= Math.pow(0.18, dtSec);

      if (gl && program) {
        gl.useProgram(program);
        gl.uniform1f(uTimeLoc, simTime);
        gl.uniform2f(uResLoc, canvas.width, canvas.height);
        gl.uniform2f(uPtrLoc, pointer.x, 1.0 - pointer.y);
        gl.uniform2f(uVelLoc, pointer.vx, -pointer.vy);
        gl.uniform1f(uImpulseLoc, pointer.impulse);
        gl.uniform1f(uZenLoc, zenCurrent);
        gl.uniform1f(
          uQualityLoc,
          activeTier === 'high' ? 3.0 : activeTier === 'balanced' ? 2.0 : 1.0
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return;
      }

      if (ctx2d) {
        const w = canvas.width;
        const h = canvas.height;
        const baseGrad = ctx2d.createLinearGradient(0, 0, w, h);
        baseGrad.addColorStop(0, '#f4f8ff');
        baseGrad.addColorStop(0.5, '#e6f0ff');
        baseGrad.addColorStop(1, '#efeaff');
        ctx2d.fillStyle = baseGrad;
        ctx2d.fillRect(0, 0, w, h);

        const orbs = [
          {
            cx: w * (0.28 + Math.sin(simTime * 0.28) * 0.12),
            cy: h * (0.25 + Math.cos(simTime * 0.22) * 0.1),
            r: Math.max(w, h) * 0.55,
            c0: 'rgba(59, 130, 246, 0.34)',
          },
          {
            cx: w * (0.74 + Math.cos(simTime * 0.24) * 0.11),
            cy: h * (0.35 + Math.sin(simTime * 0.26) * 0.12),
            r: Math.max(w, h) * 0.5,
            c0: 'rgba(34, 211, 238, 0.32)',
          },
          {
            cx: w * (0.55 + Math.sin(simTime * 0.2 + 1.8) * 0.14),
            cy: h * (0.78 + Math.cos(simTime * 0.25) * 0.09),
            r: Math.max(w, h) * 0.48,
            c0: 'rgba(139, 92, 246, 0.26)',
          },
          {
            cx: w * pointer.x,
            cy: h * pointer.y,
            r: Math.max(w, h) * 0.36,
            c0: `rgba(103, 232, 249, ${(0.16 + pointer.impulse * 0.2).toFixed(3)})`,
          },
        ];

        for (const orb of orbs) {
          const rad = ctx2d.createRadialGradient(orb.cx, orb.cy, 0, orb.cx, orb.cy, orb.r);
          rad.addColorStop(0, orb.c0);
          rad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx2d.fillStyle = rad;
          ctx2d.fillRect(0, 0, w, h);
        }

        if (zenCurrent > 0.01) {
          ctx2d.fillStyle = `rgba(235, 242, 252, ${(zenCurrent * 0.55).toFixed(3)})`;
          ctx2d.fillRect(0, 0, w, h);
        }
      }
    };

    const resizeCanvas = () => {
      if (isDisposed) return;
      const baseDpr = window.devicePixelRatio || 1;
      const tierScale = gl
        ? activeTier === 'high'
          ? Math.min(3, Math.max(1, baseDpr))
          : activeTier === 'balanced'
            ? Math.min(2, Math.max(1.5, baseDpr))
            : Math.min(1, baseDpr)
        : activeTier === 'high'
          ? 0.45
          : activeTier === 'balanced'
            ? 0.3
            : 0.2;
      const width = Math.max(1, Math.round(window.innerWidth * tierScale));
      const height = Math.max(1, Math.round(window.innerHeight * tierScale));
      let resized = false;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        resized = true;
      }
      if (gl) {
        gl.viewport(0, 0, width, height);
      }
      if (resized) {
        drawFrame(0.016);
      }
    };

    const tick = (now: number) => {
      if (isDisposed || isTabHidden) {
        rafId = null;
        return;
      }

      if (prefersReduced) {
        drawFrame(0.016);
        rafId = null;
        return;
      }

      const isInteractiveImpulse = pointer.impulse > 0.08;
      const minIntervalMs = gl
        ? activeTier === 'high'
          ? 14
          : activeTier === 'balanced'
            ? 24
            : 36
        : activeTier === 'high'
          ? 48
          : activeTier === 'balanced'
            ? 64
            : isInteractiveImpulse
              ? 36
              : 120;
      const elapsedMs = now - lastFrameMs;

      if (elapsedMs >= minIntervalMs) {
        const dtSec = Math.min(0.12, elapsedMs / 1000);
        lastFrameMs = now;
        drawFrame(dtSec);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    const scheduleLoop = () => {
      if (isDisposed || isTabHidden) return;
      if (prefersReduced) {
        drawFrame(0.016);
        return;
      }
      if (rafId === null) {
        lastFrameMs = performance.now();
        rafId = window.requestAnimationFrame(tick);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (prefersReduced) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      pointer.targetX = Math.min(1, Math.max(0, e.clientX / w));
      pointer.targetY = Math.min(1, Math.max(0, e.clientY / h));
      pointer.impulse = Math.min(1.0, pointer.impulse + 0.08);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (prefersReduced) return;
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      pointer.targetX = Math.min(1, Math.max(0, e.clientX / w));
      pointer.targetY = Math.min(1, Math.max(0, e.clientY / h));
      pointer.impulse = 1.0;
    };

    const onVisibilityChange = () => {
      isTabHidden = document.hidden;
      if (isTabHidden && rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!isTabHidden) {
        scheduleLoop();
      }
    };

    const onContextLost = (e: Event) => {
      e.preventDefault();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    const onContextRestored = () => {
      initContext();
      resizeCanvas();
      scheduleLoop();
    };

    const tierObserver = new MutationObserver(() => {
      const next = readTier();
      if (next !== activeTier) {
        activeTier = next;
        resizeCanvas();
        scheduleLoop();
      }
    });

    onZenChangeRef.current = () => {
      if (!isDisposed && prefersReduced) {
        zenCurrent = zenTargetRef.current;
        drawFrame(0.016);
      }
    };

    initContext();
    resizeCanvas();
    drawFrame(0.016);
    scheduleLoop();

    tierObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-perf-tier'],
    });
    window.addEventListener('resize', resizeCanvas, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    return () => {
      isDisposed = true;
      onZenChangeRef.current = null;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      tierObserver.disconnect();
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      }
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="living-fluid-canvas"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 h-full w-full block"
    />
  );
};
