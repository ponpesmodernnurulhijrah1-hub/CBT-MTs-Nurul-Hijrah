export type ConnectionPhase = 'connecting' | 'connected' | 'retrying' | 'offline' | 'error';

export const DEFAULT_CONNECTION_TIMEOUT_MS = 6500;
export const MAX_AUTO_RETRY_ATTEMPTS = 3;

export class ConnectionTimeoutError extends Error {
  constructor(message = 'Waktu koneksi ke server habis.') {
    super(message);
    this.name = 'ConnectionTimeoutError';
  }
}

/**
 * Races an async promise against a strict timeout so cold-start network stalls
 * never trap the app in an infinite loading state.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_CONNECTION_TIMEOUT_MS,
  timeoutMessage: string = 'Koneksi ke server melewati batas waktu.'
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          reject(new ConnectionTimeoutError(timeoutMessage));
        }, Math.max(100, timeoutMs));
      }),
    ]);
  } finally {
    if (timerId !== null) clearTimeout(timerId);
  }
}

/**
 * Performs a fetch wrapped with an AbortController timeout so slow or unreachable
 * endpoints fail cleanly within 5-8 seconds instead of hanging.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = 6000
): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = init.signal;

  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  const timerId = setTimeout(() => {
    controller.abort();
  }, Math.max(100, timeoutMs));

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ConnectionTimeoutError(`Permintaan jaringan melebihi batas ${Math.round(timeoutMs / 1000)} detik.`);
    }
    throw err;
  } finally {
    clearTimeout(timerId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/**
 * Calculates bounded exponential backoff delay for automatic connection retries.
 */
export function computeRetryDelayMs(
  attempt: number,
  baseMs: number = 1500,
  maxMs: number = 8000
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const raw = baseMs * Math.pow(2, safeAttempt - 1);
  return Math.min(maxMs, raw);
}

export interface ConnectionBannerModel {
  visible: boolean;
  tone: 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  showRetryButton: boolean;
}

/**
 * Derives a clear, non-blocking fallback UI banner state from backend/Firestore connectivity.
 */
export function deriveConnectionBannerState(params: {
  phase: ConnectionPhase;
  attempt: number;
  maxAttempts: number;
  errorMessage?: string | null;
  hasConfirmedCloudSync: boolean;
  slowConnectingElapsed: boolean;
}): ConnectionBannerModel {
  if (params.phase === 'connected') {
    return {
      visible: false,
      tone: 'info',
      title: '',
      detail: '',
      showRetryButton: false,
    };
  }

  if (params.phase === 'offline') {
    return {
      visible: true,
      tone: 'warning',
      title: 'Mode Offline — Koneksi internet perangkat terputus',
      detail: 'Data tersimpan aman di perangkat dan akan tersinkron otomatis saat koneksi kembali.',
      showRetryButton: true,
    };
  }

  if (params.phase === 'error') {
    return {
      visible: true,
      tone: 'error',
      title: 'Gagal terhubung ke server pusat',
      detail:
        params.errorMessage ||
        'Koneksi ke database/API melewati batas waktu. Klik Hubungkan Ulang untuk mencoba lagi.',
      showRetryButton: true,
    };
  }

  if (params.phase === 'retrying') {
    return {
      visible: true,
      tone: 'warning',
      title: `Koneksi lambat — Mencoba ulang otomatis (${params.attempt}/${params.maxAttempts})`,
      detail:
        params.errorMessage ||
        'Sedang mengambil data terbaru dari server pusat tanpa memblokir akses halaman.',
      showRetryButton: true,
    };
  }

  // 'connecting'
  if (params.slowConnectingElapsed && !params.hasConfirmedCloudSync) {
    return {
      visible: true,
      tone: 'info',
      title: 'Menghubungkan ke database pusat...',
      detail: 'Menunggu respons server (maks. 6 detik). Anda tetap dapat menggunakan halaman ini.',
      showRetryButton: true,
    };
  }

  return {
    visible: false,
    tone: 'info',
    title: '',
    detail: '',
    showRetryButton: false,
  };
}

/**
 * Wraps dynamic React.lazy imports with one automatic retry so transient cold-start
 * chunk errors never hang <Suspense> indefinitely.
 */
export function retryLazyImport<T>(
  importer: () => Promise<T>,
  retries: number = 1,
  delayMs: number = 800
): Promise<T> {
  return importer().catch((err) => {
    if (retries <= 0) throw err;
    return new Promise<T>((resolve, reject) => {
      setTimeout(() => {
        retryLazyImport(importer, retries - 1, delayMs).then(resolve, reject);
      }, delayMs);
    });
  });
}
