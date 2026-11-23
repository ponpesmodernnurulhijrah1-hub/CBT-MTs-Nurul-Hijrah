import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface PortalErrorBoundaryProps {
  children: React.ReactNode;
  portalLabel?: string;
  onRetry?: () => void;
}

interface PortalErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class PortalErrorBoundary extends React.Component<
  PortalErrorBoundaryProps,
  PortalErrorBoundaryState
> {
  constructor(props: PortalErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): PortalErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Gagal memuat modul halaman dari server.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-xl px-4 py-12">
          <div className="surface-card rounded-2xl border border-rose-200 bg-white/90 p-6 text-center shadow-sm">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2 className="mt-4 font-display text-lg font-bold text-slate-900">
              Gagal Memuat {this.props.portalLabel || 'Halaman'}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              {this.state.message} Pastikan koneksi internet stabil atau perbarui sesi halaman untuk mengambil aset terbaru.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  this.setState({ hasError: false, message: '' });
                  this.props.onRetry?.();
                }}
                className="btn-press min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Coba Muat Modul</span>
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-press min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Muat Ulang Aplikasi</span>
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
