import React, { lazy, Suspense, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  BookMarked,
  Users,
  UserCheck,
  Database,
  Video,
  ClipboardList,
  LogOut,
  Plus,
  Edit3,
  Trash2,
  Printer,
  Shield,
  X,
  ArrowUpRight,
  Copy,
  Check,
  Search,
  Sparkles,
  CheckCircle2,
  Power,
  Layers,
  Eye,
  EyeOff,
  History,
} from 'lucide-react';
import type {
  AdminAccount,
  ClassItem,
  ExamResult,
  ExamSchedule,
  LiveStreamSession,
  Question,
  SubjectItem,
  SyncLogEntry,
  SyncStatusInfo,
  TeacherAccount,
} from '../types/cbt';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { printPrivacySafeTeacherDirectory } from '../utils/exportHelpers';
import { hashCredential } from '../utils/crypto';
import { getTeacherSubjects } from '../utils/storeSyncUtils';
import { useActiveMotionFlag, useLiquidMorphPill, useTabSlideDirection } from '../hooks/useLiquidMotion';

const BankSoalPanel = lazy(() =>
  import('./BankSoalPanel').then((m) => ({ default: m.BankSoalPanel }))
);
const JadwalTesPanel = lazy(() =>
  import('./JadwalTesPanel').then((m) => ({ default: m.JadwalTesPanel }))
);
const LiveMonitoringGrid = lazy(() =>
  import('./LiveMonitoringGrid').then((m) => ({ default: m.LiveMonitoringGrid }))
);

const TeacherAnalytics = lazy(() =>
  import('./TeacherAnalytics').then((m) => ({ default: m.TeacherAnalytics }))
);
const ResultsPanel = lazy(() =>
  import('./ResultsPanel').then((m) => ({ default: m.ResultsPanel }))
);
const SmartImportPanel = lazy(() =>
  import('./SmartImportPanel').then((m) => ({ default: m.SmartImportPanel }))
);
const SyncLogsPanel = lazy(() =>
  import('./SyncLogsPanel').then((m) => ({ default: m.SyncLogsPanel }))
);

const PanelFallback = () => (
  <div className="surface-card p-8 text-center text-xs text-slate-500">
    Memuat data analitik...
  </div>
);

export type AdminTab =
  | 'ringkasan'
  | 'mapel'
  | 'kelas'
  | 'guru'
  | 'bank-jadwal'
  | 'ai-import'
  | 'monitoring'
  | 'rekap'
  | 'log-sinkron';

const ADMIN_TAB_ORDER: readonly AdminTab[] = [
  'ringkasan',
  'mapel',
  'kelas',
  'guru',
  'bank-jadwal',
  'ai-import',
  'monitoring',
  'rekap',
  'log-sinkron',
];

interface AdminPortalProps {
  loggedAdmin: AdminAccount | null;
  onSetLoggedAdmin: (a: AdminAccount | null) => void;
  subjects: SubjectItem[];
  classes: ClassItem[];
  teachers: TeacherAccount[];
  questions: Question[];
  exams: ExamSchedule[];
  results: ExamResult[];
  liveStreams: LiveStreamSession[];
  onAuthenticate: (username: string, password: string) => Promise<AdminAccount | null>;
  onAddSubject: (nama: string, kode: string) => Promise<unknown>;
  onUpdateSubject: (id: string, nama: string, kode: string) => Promise<void>;
  onDeleteSubject: (id: string) => Promise<void>;
  onAddClass: (nama: string, tingkat: string) => Promise<unknown>;
  onUpdateClass: (id: string, nama: string, tingkat: string) => Promise<void>;
  onDeleteClass: (id: string) => Promise<void>;
  onAddTeacher: (params: {
    nama: string;
    mataPelajaran: string;
    mataPelajaranList?: string[];
    username: string;
    password: string;
  }) => Promise<unknown>;
  onUpdateTeacher: (
    id: string,
    params: {
      nama: string;
      mataPelajaran: string;
      mataPelajaranList?: string[];
      newUsername?: string;
      newPassword?: string;
      aktif: boolean;
    }
  ) => Promise<void>;
  onDeleteTeacher: (id: string) => Promise<void>;
  onAddQuestion: (q: Omit<Question, 'id' | 'createdAt'>) => Promise<unknown>;
  onAddQuestionsBatch: (items: Array<Omit<Question, 'id' | 'createdAt'>>) => Promise<unknown>;
  onUpdateQuestion: (q: Question) => Promise<void>;
  onDeleteQuestion: (id: string) => Promise<void>;
  onDeleteQuestionsBatch?: (ids: string[]) => Promise<void>;
  onClearBankBySubject: (subj: string) => Promise<void>;
  onSaveExam: (exam: ExamSchedule) => Promise<void>;
  onToggleExamActive: (id: string) => Promise<void>;
  onDeleteExam: (id: string) => Promise<void>;
  onSendProctorWarning: (sessionId: string, msg: string) => Promise<void>;
  onUpdateEssayScore: (resultId: string, essayPercent: number, finalScore: number) => Promise<void>;
  onDeleteResult: (resultId: string) => Promise<void>;
  activeTab?: AdminTab;
  onActiveTabChange?: (tab: AdminTab) => void;
  onOpenGoogleSheets?: (targetResults: ExamResult[], defaultTitle?: string) => void;
  syncInfo: SyncStatusInfo;
  syncLogs?: SyncLogEntry[];
  onForceSync?: () => Promise<void>;
  onOpenDiagnostics?: () => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  loggedAdmin,
  onSetLoggedAdmin,
  subjects,
  classes,
  teachers,
  questions,
  exams,
  results,
  liveStreams,
  onAuthenticate,
  onAddSubject,
  onUpdateSubject,
  onDeleteSubject,
  onAddClass,
  onUpdateClass,
  onDeleteClass,
  onAddTeacher,
  onUpdateTeacher,
  onDeleteTeacher,
  onAddQuestion,
  onAddQuestionsBatch,
  onUpdateQuestion,
  onDeleteQuestion,
  onDeleteQuestionsBatch,
  onClearBankBySubject,
  onSaveExam,
  onToggleExamActive,
  onDeleteExam,
  onSendProctorWarning,
  onUpdateEssayScore,
  onDeleteResult,
  activeTab: controlledTab,
  onActiveTabChange,
  onOpenGoogleSheets,
  syncInfo,
  syncLogs = [],
  onForceSync,
  onOpenDiagnostics,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [internalTab, setInternalTab] = useState<AdminTab>('ringkasan');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (next: AdminTab) => {
    if (controlledTab === undefined) setInternalTab(next);
    onActiveTabChange?.(next);
  };
  const [rekapPresetStatus, setRekapPresetStatus] = useState<'ALL' | 'Selesai' | 'Pelanggaran'>('ALL');
  const mobNavRef = useRef<HTMLElement | null>(null);
  const deskNavRef = useRef<HTMLElement | null>(null);
  const tabSlideDirection = useTabSlideDirection(ADMIN_TAB_ORDER, activeTab);
  const tabMotion = useActiveMotionFlag(activeTab, 400);
  const tabSlideClass =
    tabSlideDirection === 'forward'
      ? 'tab-slide-forward'
      : tabSlideDirection === 'backward'
        ? 'tab-slide-backward'
        : 'tab-slide-up';
  const navMorphSignature = `${loggedAdmin?.id ?? 'out'}-${subjects.length}-${classes.length}-${teachers.length}-${questions.length}-${liveStreams.length}-${results.length}-${syncLogs.length}`;
  const mobMorph = useLiquidMorphPill(mobNavRef, loggedAdmin ? activeTab : null, navMorphSignature);
  const deskMorph = useLiquidMorphPill(deskNavRef, loggedAdmin ? activeTab : null, navMorphSignature);

  // Subject CRUD & Search state
  const [subjNama, setSubjNama] = useState('');
  const [subjKode, setSubjKode] = useState('');
  const [subjSearch, setSubjSearch] = useState('');
  const [subjFormError, setSubjFormError] = useState<string | null>(null);
  const [editingSubj, setEditingSubj] = useState<SubjectItem | null>(null);

  // Class CRUD & Filter state
  const [clsNama, setClsNama] = useState('');
  const [clsTingkat, setClsTingkat] = useState('VII');
  const [clsFilter, setClsFilter] = useState('');
  const [clsFormError, setClsFormError] = useState<string | null>(null);
  const [editingCls, setEditingCls] = useState<ClassItem | null>(null);

  // Teacher CRUD state (Privacy-Hardened + Multi-Subject)
  const [guruNama, setGuruNama] = useState('');
  const [guruMapel, setGuruMapel] = useState(subjects[0]?.nama || '');
  const [guruMapelList, setGuruMapelList] = useState<string[]>([]);
  const [guruUsername, setGuruUsername] = useState('');
  const [guruPassword, setGuruPassword] = useState('');
  const [guruFormError, setGuruFormError] = useState<string | null>(null);
  const [showAddGuruPassword, setShowAddGuruPassword] = useState(false);
  const [guruSearch, setGuruSearch] = useState('');
  const [editingTeacher, setEditingTeacher] = useState<TeacherAccount | null>(null);
  const [editGuruNama, setEditGuruNama] = useState('');
  const [editGuruMapel, setEditGuruMapel] = useState('');
  const [editGuruMapelList, setEditGuruMapelList] = useState<string[]>([]);
  const [editGuruNewPassword, setEditGuruNewPassword] = useState('');
  const [showEditGuruPassword, setShowEditGuruPassword] = useState(false);
  const [editGuruAktif, setEditGuruAktif] = useState(true);

  // Admin Bank Soal filter, Global Quick Jump & Token Copy
  const [adminSelectedMapel, setAdminSelectedMapel] = useState(subjects[0]?.nama || '');
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  const [ringkasanSearch, setRingkasanSearch] = useState('');

  const filteredSubjects = useMemo(() => {
    const q = subjSearch.trim().toLowerCase();
    return q
      ? subjects.filter(
          (s) => s.nama.toLowerCase().includes(q) || s.kode.toLowerCase().includes(q)
        )
      : subjects;
  }, [subjects, subjSearch]);

  const filteredClasses = useMemo(() => {
    const q = clsFilter.trim().toLowerCase();
    return q
      ? classes.filter(
          (c) => c.nama.toLowerCase().includes(q) || c.tingkat.toLowerCase().includes(q)
        )
      : classes;
  }, [classes, clsFilter]);

  const filteredTeachers = useMemo(() => {
    const q = guruSearch.trim().toLowerCase();
    return q
      ? teachers.filter(
          (t) =>
            t.nama.toLowerCase().includes(q) ||
            getTeacherSubjects(t).some((s) => s.toLowerCase().includes(q))
        )
      : teachers;
  }, [teachers, guruSearch]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setLoginError(null);
    if (!username.trim() || !password) {
      setLoginError('Masukkan username dan password administrator.');
      return;
    }
    setIsLoggingIn(true);
    try {
      const admin = await onAuthenticate(username, password);
      if (!admin) {
        setLoginError('Kredensial administrator tidak valid.');
        return;
      }
      onSetLoggedAdmin(admin);
      setUsername('');
      setPassword('');
    } catch (err) {
      setLoginError(
        err instanceof Error && err.message
          ? err.message
          : 'Gagal memverifikasi akun administrator. Coba lagi sebentar.'
      );
    } finally {
      setIsLoggingIn(false);
    }
  };

  // STRICT PRIVACY: Clean 2-Column Command Login with ZERO demo credentials / quick-login buttons
  if (!loggedAdmin) {
    return (
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-12 panel-enter">
        <div className="surface-card rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-12 items-stretch">
          <div className="glass-dark md:col-span-5 p-7 sm:p-8 text-white flex flex-col justify-between border-0 border-b md:border-b-0 md:border-r border-white/15">
            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/35 text-emerald-300">
                <Shield className="h-5 w-5" />
              </span>
              <p className="mt-5 text-xs font-semibold text-emerald-300">
                Pusat Kendali &middot; CBT MTs Nurul Hijrah
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
                Konsol Super Admin
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-slate-200">
                Atur mata pelajaran dinamis, rombongan belajar, akun guru terenkripsi, jadwal ujian pusat, dan pantau seluruh peserta ujian secara terpusat.
              </p>
            </div>

            <ul className="mt-6 space-y-2.5 border-t border-white/15 pt-5 text-xs text-slate-200">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Sinkronisasi mapel, kelas &amp; akun guru</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Studio Soal AI &amp; kelola token jadwal</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Rekap nilai &amp; pengawasan kamera pusat</span>
              </li>
            </ul>
          </div>

          <form onSubmit={handleLogin} className="md:col-span-7 p-7 sm:p-8 flex flex-col justify-center space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Autentikasi Administrator
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Masuk menggunakan akun pengelola utama sistem CBT sekolah.
              </p>
            </div>

            <div>
              <label htmlFor="admin-username" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username admin"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="admin-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type={showAdminPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="glass-input w-full rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowAdminPassword((s) => !s)}
                  aria-label={showAdminPassword ? 'Sembunyikan password' : 'Lihat password'}
                  className="btn-press absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                >
                  {showAdminPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {loginError && (
              <div className="rounded-xl border border-red-300/70 bg-red-500/15 px-3.5 py-2.5 text-xs font-medium text-red-900">
                {loginError}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="btn-press w-full rounded-xl bg-slate-900/95 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 shadow-[0_10px_24px_-10px_rgba(15,23,42,0.5)]"
            >
              {isLoggingIn ? 'Memverifikasi...' : 'Masuk Panel Super Admin'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const subjectNames = Array.from(new Set(subjects.map((s) => s.nama)));
  const classNames = Array.from(new Set(classes.map((c) => c.nama)));
  const effectiveAdminMapel = subjectNames.includes(adminSelectedMapel)
    ? adminSelectedMapel
    : subjectNames[0] || '';
  const effectiveGuruMapel = subjectNames.includes(guruMapel)
    ? guruMapel
    : subjectNames[0] || '';
  const activeLiveCount = liveStreams.filter((s) => s.status === 'aktif').length;
  const activeExams = exams.filter((e) => e.aktif);
  const activeTeachersCount = teachers.filter((t) => t.aktif).length;
  const uniqueStudentCount = new Set([
    ...results.map((r) => `${r.namaSiswa.trim().toLowerCase()}|${r.kelas.trim().toLowerCase()}`),
    ...liveStreams
      .filter((s) => s.status === 'aktif')
      .map((s) => `${s.namaSiswa.trim().toLowerCase()}|${s.kelas.trim().toLowerCase()}`),
  ]).size;

  const navItems: Array<{
    id: AdminTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    { id: 'ringkasan', label: 'Ringkasan Pusat', icon: <LayoutDashboard className="h-4 w-4" /> },
    {
      id: 'mapel',
      label: 'Mata Pelajaran Dinamis',
      icon: <BookMarked className="h-4 w-4" />,
      count: subjects.length,
    },
    {
      id: 'kelas',
      label: 'Manajemen Kelas',
      icon: <Users className="h-4 w-4" />,
      count: classes.length,
    },
    {
      id: 'guru',
      label: 'Manajemen Guru',
      icon: <UserCheck className="h-4 w-4" />,
      count: teachers.length,
    },
    {
      id: 'bank-jadwal',
      label: 'Bank Soal & Jadwal',
      icon: <Database className="h-4 w-4" />,
      count: questions.length,
    },
    {
      id: 'ai-import',
      label: 'Studio Soal AI',
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      id: 'monitoring',
      label: 'Live Monitoring Pusat',
      icon: <Video className="h-4 w-4" />,
      count: activeLiveCount,
    },
    {
      id: 'rekap',
      label: 'Rekap Nilai Semua Mapel',
      icon: <ClipboardList className="h-4 w-4" />,
      count: results.length,
    },
    {
      id: 'log-sinkron',
      label: 'Log Sinkronisasi',
      icon: <History className="h-4 w-4" />,
      count: syncLogs.length,
    },
  ];

  const activeNav = navItems.find((n) => n.id === activeTab);

  const openEditTeacherModal = (t: TeacherAccount) => {
    const subjList = getTeacherSubjects(t);
    setEditingTeacher(t);
    setEditGuruNama(t.nama);
    setEditGuruMapel(t.mataPelajaran);
    setEditGuruMapelList(subjList);
    setEditGuruNewPassword('');
    setShowEditGuruPassword(false);
    setEditGuruAktif(t.aktif);
  };

  const subjectStats = subjects
    .map((s) => ({
      ...s,
      qCount: questions.filter((q) => q.mataPelajaran === s.nama).length,
      activeExamCount: exams.filter((e) => e.mataPelajaran === s.nama && e.aktif).length,
      resCount: results.filter((r) => r.mataPelajaran === s.nama).length,
    }))
    .sort((a, b) => b.qCount - a.qCount);

  const maxSubjectQuestions = Math.max(1, ...subjectStats.map((s) => s.qCount));

  const quickQuery = ringkasanSearch.trim().toLowerCase();
  const quickSubjects = quickQuery
    ? subjects.filter(
        (s) =>
          s.nama.toLowerCase().includes(quickQuery) ||
          s.kode.toLowerCase().includes(quickQuery)
      )
    : [];
  const quickTeachers = quickQuery
    ? teachers.filter(
        (t) =>
          t.nama.toLowerCase().includes(quickQuery) ||
          t.mataPelajaran.toLowerCase().includes(quickQuery)
      )
    : [];
  const quickExams = quickQuery
    ? exams.filter(
        (ex) =>
          ex.mataPelajaran.toLowerCase().includes(quickQuery) ||
          ex.judulUjian.toLowerCase().includes(quickQuery) ||
          ex.token.toLowerCase().includes(quickQuery)
      )
    : [];

  return (
    <div className="mx-auto flex max-w-7xl flex-col lg:flex-row gap-4 lg:gap-6 px-3.5 sm:px-6 py-4 sm:py-6 panel-enter">
      {/* Executive Dark Glass Sidebar (Compact on Phone/Tablet, Sticky Rail on Laptop/Desktop) */}
      <aside className="w-full lg:w-64 shrink-0 space-y-3 lg:space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="glass-dark rounded-3xl p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/35 text-emerald-300">
                <Shield className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                  Super Admin
                </p>
                <h2 className="font-display text-[13px] sm:text-sm font-bold leading-tight truncate">
                  {loggedAdmin.nama}
                </h2>
                <p className="truncate text-xs text-slate-300">Kendali Penuh Server</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSetLoggedAdmin(null)}
              aria-label="Keluar Admin"
              className="btn-press lg:hidden min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Keluar</span>
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3 text-left">
            <button
              type="button"
              onClick={() => setActiveTab('bank-jadwal')}
              className="btn-press min-h-[44px] rounded-xl bg-white/10 border border-white/15 px-2.5 py-2 hover:bg-white/15"
            >
              <p className="text-[10px] text-slate-300">Jadwal Aktif</p>
              <p className="font-mono-tabular text-sm font-bold text-emerald-300">
                {activeExams.length}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monitoring')}
              className="btn-press min-h-[44px] rounded-xl bg-white/10 border border-white/15 px-2.5 py-2 hover:bg-white/15"
            >
              <p className="text-[10px] text-slate-300">Live Siswa</p>
              <p className="font-mono-tabular text-sm font-bold text-white">
                {activeLiveCount}
              </p>
            </button>
          </div>

          <div className="hidden lg:block">
            <SyncStatusIndicator
              syncInfo={syncInfo}
              onForceSync={onForceSync}
              variant="sidebar"
            />
          </div>

          <button
            type="button"
            onClick={() => onSetLoggedAdmin(null)}
            className="btn-press hidden lg:inline-flex mt-3 w-full items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Keluar Admin</span>
          </button>
        </div>

        {/* Mobile & Tablet Horizontal Scrollable Tab Strip (< lg) */}
        <nav
          ref={mobNavRef}
          aria-label="Menu Super Admin Mobile"
          className="relative lg:hidden flex items-center gap-1.5 overflow-x-auto no-scrollbar rounded-2xl border border-white/60 border-t-white/85 border-l-white/75 bg-white/45 backdrop-blur-md p-1.5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.82),0_10px_24px_-14px_rgba(30,58,138,0.16)]"
        >
          <div aria-hidden="true" className="liquid-gooey-stage pointer-events-none absolute inset-0 z-0">
            <span
              style={mobMorph.pillStyle}
              data-morphing={mobMorph.isMorphing ? 'true' : undefined}
              data-morph-animating={mobMorph.isMoving ? 'true' : undefined}
              data-morph-axis={mobMorph.morphAxis}
              className="liquid-morph-pill-accent rounded-xl"
            />
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={`mob-${item.id}`}
                type="button"
                data-morph-active={isActive ? 'true' : undefined}
                onClick={() => {
                  if (item.id === 'rekap') setRekapPresetStatus('ALL');
                  setActiveTab(item.id);
                }}
                className={`btn-press relative z-10 min-h-[42px] inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors duration-200 ${
                  isActive
                    ? mobMorph.visible
                      ? 'border-transparent text-white'
                      : 'border-emerald-600/50 bg-emerald-700 text-white shadow-xs'
                    : 'border-transparent text-slate-800 hover:bg-white/45'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                {typeof item.count === 'number' && (
                  <span
                    className={`font-mono-tabular text-[11px] ${
                      isActive ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    ({item.count})
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Desktop Vertical Navigation Rail (>= lg) */}
        <nav
          ref={deskNavRef}
          aria-label="Menu Super Admin Desktop"
          className="relative hidden lg:block surface-card rounded-3xl p-2 space-y-1"
        >
          <div aria-hidden="true" className="liquid-gooey-stage pointer-events-none absolute inset-0 z-0">
            <span
              style={deskMorph.pillStyle}
              data-morphing={deskMorph.isMorphing ? 'true' : undefined}
              data-morph-animating={deskMorph.isMoving ? 'true' : undefined}
              data-morph-axis={deskMorph.morphAxis}
              className="liquid-morph-pill-accent rounded-xl"
            />
          </div>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                data-morph-active={isActive ? 'true' : undefined}
                onClick={() => {
                  if (item.id === 'rekap') setRekapPresetStatus('ALL');
                  setActiveTab(item.id);
                }}
                className={`btn-press relative z-10 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors duration-200 ${
                  isActive
                    ? deskMorph.visible
                      ? 'text-white'
                      : 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </span>
                {typeof item.count === 'number' && (
                  <span
                    className={`font-mono-tabular text-[11px] shrink-0 ${
                      isActive ? 'text-emerald-100' : 'text-slate-500'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <section className="flex-1 min-w-0 space-y-5 sm:space-y-6">
        {/* Contextual Top Action Bar */}
        <div className="relative z-30 surface-card rounded-3xl flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Pusat Kendali Super Admin &middot; MTs Nurul Hijrah
            </p>
            <h1 className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate">
              {activeNav?.label}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SyncStatusIndicator
              syncInfo={syncInfo}
              onForceSync={onForceSync}
              onOpenSyncLogs={() => setActiveTab('log-sinkron')}
              variant="banner"
            />
            <button
              type="button"
              onClick={() => setActiveTab('monitoring')}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90 whitespace-nowrap shrink-0"
            >
              <Video className="h-4 w-4 text-emerald-700" />
              <span>Live Monitoring ({activeLiveCount})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setRekapPresetStatus('ALL');
                setActiveTab('rekap');
              }}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0"
            >
              <ClipboardList className="h-4 w-4" />
              <span>Rekap Nilai ({results.length})</span>
            </button>
          </div>
        </div>

        {activeTab === 'ringkasan' && (
          <div
            key="ringkasan"
            className={`space-y-6 ${tabSlideClass}`}
            data-admin-tab-panel="ringkasan"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            {/* Global Quick Jump / Search Bar */}
            <div className="surface-card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={ringkasanSearch}
                    onChange={(e) => setRingkasanSearch(e.target.value)}
                    placeholder="Cari cepat mata pelajaran, nama guru, jadwal ujian, atau token..."
                    className="glass-input w-full rounded-xl pl-10 pr-9 py-2 text-xs text-slate-900"
                  />
                  {ringkasanSearch && (
                    <button
                      type="button"
                      onClick={() => setRingkasanSearch('')}
                      aria-label="Bersihkan pencarian cepat"
                      className="btn-press absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:text-slate-800"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <span className="font-mono-tabular text-xs text-slate-600 shrink-0">
                  {questions.length} total soal &middot; {activeExams.length} jadwal aktif
                </span>
              </div>

              {quickQuery && (
                <div className="border-t border-white/50 pt-3">
                  {quickSubjects.length === 0 && quickTeachers.length === 0 && quickExams.length === 0 ? (
                    <p className="text-xs text-slate-600">
                      Tidak ditemukan mapel, guru, atau token yang cocok dengan &ldquo;{ringkasanSearch}&rdquo;.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {quickSubjects.slice(0, 4).map((s) => (
                        <button
                          key={`qs-${s.id}`}
                          type="button"
                          onClick={() => {
                            setAdminSelectedMapel(s.nama);
                            setActiveTab('bank-jadwal');
                          }}
                          className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/50 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-500/25"
                        >
                          <BookMarked className="h-3.5 w-3.5 text-emerald-700" />
                          <span>Bank Soal: {s.nama}</span>
                        </button>
                      ))}
                      {quickTeachers.slice(0, 4).map((t) => (
                        <button
                          key={`qt-${t.id}`}
                          type="button"
                          onClick={() => {
                            setGuruSearch(t.nama);
                            setActiveTab('guru');
                          }}
                          className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white/85"
                        >
                          <UserCheck className="h-3.5 w-3.5 text-slate-600" />
                          <span>Guru: {t.nama} ({t.mataPelajaran})</span>
                        </button>
                      ))}
                      {quickExams.slice(0, 4).map((ex) => (
                        <button
                          key={`qe-${ex.id}`}
                          type="button"
                          onClick={() => {
                            setAdminSelectedMapel(ex.mataPelajaran);
                            setActiveTab('bank-jadwal');
                          }}
                          className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white/85"
                        >
                          <Database className="h-3.5 w-3.5 text-emerald-700" />
                          <span>
                            {ex.mataPelajaran} &middot; Token {ex.token}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Clickable 4-col iOS Stat Widgets (Siswa, Guru, Sesi Aktif, Bank Soal) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('rekap')}
                className="surface-card-interactive p-4 text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Jumlah Siswa</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 border border-white/80 text-slate-700 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                    <Users className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono-tabular">
                  {uniqueStudentCount}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 inline-flex items-center gap-1">
                  <span>{classes.length} kelas · {results.length} hasil tes</span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('guru')}
                className="surface-card-interactive p-4 text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Jumlah Guru</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-800 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                    <UserCheck className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold text-emerald-800 font-mono-tabular">
                  {teachers.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 inline-flex items-center gap-1">
                  <span>{activeTeachersCount} akun aktif</span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('monitoring')}
                className="surface-card-interactive p-4 text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Sesi Aktif</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-800 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                    <Video className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold text-emerald-800 font-mono-tabular">
                  {activeExams.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 inline-flex items-center gap-1">
                  <span>jadwal dibuka · {activeLiveCount} live</span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('bank-jadwal')}
                className="surface-card-interactive p-4 text-left group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">Bank Soal &amp; Mapel</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/70 border border-white/80 text-slate-700 group-hover:bg-emerald-700 group-hover:text-white transition-colors">
                    <BookMarked className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-2 text-2xl font-bold text-slate-900 font-mono-tabular">
                  {questions.length}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 inline-flex items-center gap-1">
                  <span>{subjects.length} mata pelajaran</span>
                  <ArrowUpRight className="h-3 w-3 opacity-60" />
                </p>
              </button>
            </div>

            {/* Active Schedules & Quick Token + 1-Click Toggle Strip */}
            {activeExams.length > 0 && (
              <div className="surface-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Jadwal Ujian Sedang Dibuka ({activeExams.length})
                    </h3>
                    <p className="text-xs text-slate-600">
                      Salin token ujian atau tutup sesi jadwal secara instan dari ringkasan pusat.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('bank-jadwal')}
                    className="btn-press rounded-xl px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-white/60 whitespace-nowrap"
                  >
                    Kelola Semua Jadwal
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeExams.slice(0, 6).map((ex) => (
                    <div
                      key={ex.id}
                      className="glass-subtle flex items-center justify-between gap-2 rounded-2xl px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-slate-900">{ex.mataPelajaran}</p>
                        <p className="truncate text-[11px] text-slate-600">
                          {ex.questionsSnapshot.length} soal &middot; {ex.durasiMenit} mnt
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(ex.token).catch(() => {});
                            setCopiedTokenId(ex.id);
                            window.setTimeout(() => setCopiedTokenId(null), 1800);
                          }}
                          aria-label={`Salin token ${ex.token}`}
                          className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/75 bg-white/70 px-2.5 py-1.5 font-mono-tabular text-xs font-bold text-emerald-900 hover:bg-white"
                        >
                          <span>{ex.token}</span>
                          {copiedTokenId === ex.id ? (
                            <Check className="h-3 w-3 text-emerald-700" />
                          ) : (
                            <Copy className="h-3 w-3 text-slate-500" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleExamActive(ex.id)}
                          aria-label={`Tutup jadwal ${ex.mataPelajaran}`}
                          title="Nonaktifkan jadwal ini"
                          className="btn-press rounded-xl border border-white/75 bg-white/65 p-1.5 text-slate-600 hover:border-red-300 hover:bg-red-500/15 hover:text-red-700"
                        >
                          <Power className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interactive Subject Distribution & Bank Soal Matrix */}
            {subjectStats.length > 0 && (
              <div className="surface-card p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-emerald-700 shrink-0" />
                    <div>
                      <h3 className="font-display text-sm font-bold text-slate-900">
                        Distribusi Bank Soal &amp; Rekap Per Mata Pelajaran
                      </h3>
                      <p className="text-xs text-slate-600">
                        Klik mata pelajaran di bawah untuk langsung membuka Bank Soal &amp; Jadwal mapel tersebut.
                      </p>
                    </div>
                  </div>
                  <span className="font-mono-tabular text-xs text-slate-600">
                    {subjects.length} mata pelajaran
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {subjectStats.slice(0, 8).map((st) => {
                    const widthPct = Math.round((st.qCount / maxSubjectQuestions) * 100);
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setAdminSelectedMapel(st.nama);
                          setActiveTab('bank-jadwal');
                        }}
                        className="btn-press glass-subtle rounded-2xl p-3 text-left hover:bg-white/75 transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-slate-900 truncate">{st.nama}</span>
                          <span className="font-mono-tabular text-[11px] font-semibold text-slate-600 shrink-0">
                            {st.qCount} soal &middot; {st.activeExamCount} jadwal &middot; {st.resCount} hasil
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/65">
                          <div
                            className="h-full w-full origin-left bg-emerald-600 transition-transform"
                            style={{ transform: `scaleX(${Math.max(st.qCount > 0 ? 0.06 : 0, widthPct / 100)})` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <Suspense fallback={<PanelFallback />}>
              <TeacherAnalytics
                results={results}
                questions={questions}
                subjectLabel="Semua Mata Pelajaran"
                title="Statistik Nilai Seluruh Mata Pelajaran — MTs Nurul Hijrah"
                onNavigateResults={(presetStatus) => {
                  setRekapPresetStatus(presetStatus || 'ALL');
                  setActiveTab('rekap');
                }}
              />
            </Suspense>
          </div>
        )}

        {/* TAB: DYNAMIC SUBJECTS */}
        {activeTab === 'mapel' && (
          <div
            key="mapel"
            className={`space-y-5 ${tabSlideClass}`}
            data-admin-tab-panel="mapel"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubjFormError(null);
                const cleanName = subjNama.trim();
                if (!cleanName) return;
                const duplicate = subjects.some(
                  (s) =>
                    s.nama.toLowerCase() === cleanName.toLowerCase() &&
                    s.id !== editingSubj?.id
                );
                if (duplicate) {
                  setSubjFormError(`Mata pelajaran "${cleanName}" sudah terdaftar.`);
                  return;
                }
                if (editingSubj) {
                  await onUpdateSubject(editingSubj.id, cleanName, subjKode);
                  setEditingSubj(null);
                } else {
                  await onAddSubject(cleanName, subjKode);
                }
                setSubjNama('');
                setSubjKode('');
              }}
              className="surface-card p-5 space-y-3"
            >
              <h3 className="font-display text-base font-bold text-slate-900">
                {editingSubj ? 'Edit Mata Pelajaran' : 'Tambah Mata Pelajaran Dinamis'}
              </h3>
              <p className="text-xs text-slate-600">
                Setiap perubahan langsung tersinkronisasi ke akun guru, bank soal, jadwal tes, dan portal siswa.
              </p>
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={subjNama}
                  onChange={(e) => {
                    setSubjNama(e.target.value);
                    if (subjFormError) setSubjFormError(null);
                  }}
                  placeholder="Nama Mata Pelajaran (mis. Tahfidz Al-Qur'an)"
                  className="glass-input w-full sm:w-auto sm:flex-1 sm:min-w-[200px] rounded-xl px-3.5 py-2 text-sm text-slate-900"
                />
                <input
                  type="text"
                  value={subjKode}
                  onChange={(e) => setSubjKode(e.target.value)}
                  placeholder="Kode (mis. TAHFIDZ)"
                  className="glass-input w-full sm:w-36 rounded-xl px-3.5 py-2 text-sm uppercase font-mono-tabular text-slate-900"
                />
                <button
                  type="submit"
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  <Plus className="h-4 w-4" />
                  <span>{editingSubj ? 'Simpan Perubahan' : 'Tambah Mapel'}</span>
                </button>
                {editingSubj && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingSubj(null);
                      setSubjNama('');
                      setSubjKode('');
                      setSubjFormError(null);
                    }}
                    className="btn-press rounded-xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85"
                  >
                    Batal
                  </button>
                )}
              </div>
              {subjFormError && (
                <p className="text-xs font-medium text-red-700">{subjFormError}</p>
              )}
            </form>

            <div className="surface-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/50 px-4 py-3">
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={subjSearch}
                    onChange={(e) => setSubjSearch(e.target.value)}
                    placeholder="Cari nama atau kode mapel..."
                    className="glass-input w-full rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <span className="font-mono-tabular text-xs text-slate-600">
                  {filteredSubjects.length} mata pelajaran
                </span>
              </div>
              {/* Mobile Card View (< md) */}
              <div className="md:hidden divide-y divide-white/50">
                {filteredSubjects.map((s) => (
                  <div key={`mob-subj-${s.id}`} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="font-mono-tabular text-[11px] font-bold text-emerald-800">
                        {s.kode}
                      </span>
                      <p className="font-semibold text-sm text-slate-900 truncate">{s.nama}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSubj(s);
                          setSubjNama(s.nama);
                          setSubjKode(s.kode);
                        }}
                        aria-label={`Edit mapel ${s.nama}`}
                        className="btn-press min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-white/70 bg-white/65 text-slate-700 hover:bg-white"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (editingSubj?.id === s.id) {
                            setEditingSubj(null);
                            setSubjNama('');
                            setSubjKode('');
                          }
                          await onDeleteSubject(s.id);
                        }}
                        aria-label={`Hapus mapel ${s.nama}`}
                        className="btn-press min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-red-300/70 bg-red-500/10 text-red-700 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tablet/Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/50 bg-white/35 text-xs font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Kode</th>
                      <th className="px-4 py-3">Nama Mata Pelajaran</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/45">
                    {filteredSubjects.map((s) => (
                      <tr key={s.id} className="hover:bg-white/45 transition-colors">
                        <td className="px-4 py-3 font-mono-tabular text-xs font-bold text-emerald-800">
                          {s.kode}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{s.nama}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubj(s);
                              setSubjNama(s.nama);
                              setSubjKode(s.kode);
                            }}
                            className="btn-press mr-2 inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/55 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white/85"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (editingSubj?.id === s.id) {
                                setEditingSubj(null);
                                setSubjNama('');
                                setSubjKode('');
                              }
                              await onDeleteSubject(s.id);
                            }}
                            className="btn-press inline-flex items-center gap-1 rounded-xl border border-red-300/70 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Hapus</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: DYNAMIC CLASSES */}
        {activeTab === 'kelas' && (
          <div
            key="kelas"
            className={`space-y-5 ${tabSlideClass}`}
            data-admin-tab-panel="kelas"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setClsFormError(null);
                const cleanClass = clsNama.trim();
                if (!cleanClass) return;
                const duplicate = classes.some(
                  (c) =>
                    c.nama.toLowerCase() === cleanClass.toLowerCase() &&
                    c.id !== editingCls?.id
                );
                if (duplicate) {
                  setClsFormError(`Kelas "${cleanClass}" sudah terdaftar.`);
                  return;
                }
                if (editingCls) {
                  await onUpdateClass(editingCls.id, cleanClass, clsTingkat);
                  setEditingCls(null);
                } else {
                  await onAddClass(cleanClass, clsTingkat);
                }
                setClsNama('');
              }}
              className="surface-card p-5 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-slate-900">
                  {editingCls ? 'Edit Kelas' : 'Tambah Kelas Baru (Sinkron ke Portal Siswa)'}
                </h3>
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={clsFilter}
                    onChange={(e) => setClsFilter(e.target.value)}
                    placeholder="Filter kelas..."
                    className="glass-input w-full rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <input
                  type="text"
                  value={clsNama}
                  onChange={(e) => {
                    setClsNama(e.target.value);
                    if (clsFormError) setClsFormError(null);
                  }}
                  placeholder="Nama Kelas (mis. IX C atau X IPA 1)"
                  className="glass-input w-full sm:w-auto sm:flex-1 sm:min-w-[200px] rounded-xl px-3.5 py-2 text-sm text-slate-900"
                />
                <select
                  value={clsTingkat}
                  onChange={(e) => setClsTingkat(e.target.value)}
                  className="glass-input rounded-xl px-3.5 py-2 text-sm text-slate-900"
                >
                  <option value="VII">Tingkat VII</option>
                  <option value="VIII">Tingkat VIII</option>
                  <option value="IX">Tingkat IX</option>
                  <option value="X">Tingkat X</option>
                  <option value="XI">Tingkat XI</option>
                  <option value="XII">Tingkat XII</option>
                </select>
                <button
                  type="submit"
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                >
                  <Plus className="h-4 w-4" />
                  <span>{editingCls ? 'Simpan Kelas' : 'Tambah Kelas'}</span>
                </button>
                {editingCls && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCls(null);
                      setClsNama('');
                      setClsFormError(null);
                    }}
                    className="btn-press rounded-xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white/85"
                  >
                    Batal
                  </button>
                )}
              </div>
              {clsFormError && (
                <p className="text-xs font-medium text-red-700">{clsFormError}</p>
              )}
            </form>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredClasses.map((c) => (
                <div
                  key={c.id}
                  className="surface-card-interactive flex items-center justify-between p-4"
                >
                  <div>
                    <h4 className="font-display text-sm font-bold text-slate-900">{c.nama}</h4>
                    <p className="text-xs text-slate-600">Tingkat {c.tingkat}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCls(c);
                        setClsNama(c.nama);
                        setClsTingkat(c.tingkat);
                      }}
                      aria-label={`Edit kelas ${c.nama}`}
                      className="btn-press rounded-xl border border-white/70 bg-white/55 p-1.5 text-slate-700 hover:bg-white/85"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (editingCls?.id === c.id) {
                          setEditingCls(null);
                          setClsNama('');
                        }
                        await onDeleteClass(c.id);
                      }}
                      aria-label={`Hapus kelas ${c.nama}`}
                      className="btn-press rounded-xl border border-red-300/70 bg-red-500/10 p-1.5 text-red-700 hover:bg-red-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB: PRIVACY-HARDENED TEACHER MANAGEMENT */}
        {activeTab === 'guru' && (
          <div
            key="guru"
            className={`space-y-5 ${tabSlideClass}`}
            data-admin-tab-panel="guru"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setGuruFormError(null);
                const cleanNama = guruNama.trim();
                const cleanUsername = guruUsername.trim();
                const cleanPassword = guruPassword.trim();
                if (!cleanNama || !cleanUsername || !cleanPassword) {
                  setGuruFormError('Nama, username, dan password guru wajib diisi.');
                  return;
                }
                const uHash = await hashCredential(cleanUsername);
                if (teachers.some((t) => t.usernameHash === uHash)) {
                  setGuruFormError(`Username "${cleanUsername}" sudah dipakai akun guru lain.`);
                  return;
                }
                const primary = effectiveGuruMapel || subjectNames[0] || 'Matematika';
                const extraList = Array.from(new Set([primary, ...guruMapelList]));
                await onAddTeacher({
                  nama: cleanNama,
                  mataPelajaran: primary,
                  mataPelajaranList: extraList,
                  username: cleanUsername,
                  password: cleanPassword,
                });
                setGuruNama('');
                setGuruUsername('');
                setGuruPassword('');
                setGuruMapelList([]);
              }}
              className="surface-card p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Tambah Akun Guru (Terenkripsi SHA-256)
                  </h3>
                  <p className="text-xs text-slate-600">
                    Username dan Password dienkripsi dengan SHA-256 dan tidak pernah ditampilkan kembali demi keamanan privasi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => printPrivacySafeTeacherDirectory(teachers)}
                  className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/60 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90 whitespace-nowrap"
                >
                  <Printer className="h-4 w-4 text-emerald-700" />
                  <span>Cetak Data Guru (Print / PDF)</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <input
                  type="text"
                  required
                  value={guruNama}
                  onChange={(e) => setGuruNama(e.target.value)}
                  placeholder="Nama Lengkap Guru"
                  className="glass-input rounded-xl px-3.5 py-2 text-sm text-slate-900"
                />
                <select
                  value={effectiveGuruMapel}
                  onChange={(e) => setGuruMapel(e.target.value)}
                  aria-label="Mata Pelajaran Utama Guru"
                  className="glass-input rounded-xl px-3.5 py-2 text-sm text-slate-900"
                >
                  {subjectNames.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={guruUsername}
                  onChange={(e) => setGuruUsername(e.target.value)}
                  placeholder="Username Baru"
                  className="glass-input rounded-xl px-3.5 py-2 text-sm text-slate-900"
                />
                <div className="relative">
                  <input
                    type={showAddGuruPassword ? 'text' : 'password'}
                    required
                    value={guruPassword}
                    onChange={(e) => setGuruPassword(e.target.value)}
                    placeholder="Password Baru"
                    className="glass-input w-full rounded-xl pl-3.5 pr-9 py-2 text-sm text-slate-900"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAddGuruPassword((v) => !v)}
                    aria-label={showAddGuruPassword ? 'Sembunyikan password' : 'Lihat password'}
                    className="btn-press absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                  >
                    {showAddGuruPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Optional Multi-Subject Assignment */}
              {subjectNames.length > 1 && (
                <div className="glass-subtle rounded-2xl p-3">
                  <p className="text-[11px] font-semibold text-slate-700 mb-2">
                    Mapel Tambahan yang Diampu (Opsional, bila guru mengajar &gt; 1 mapel):
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {subjectNames.map((s) => {
                      const isPrimary = s === effectiveGuruMapel;
                      const isSelected = isPrimary || guruMapelList.includes(s);
                      return (
                        <button
                          key={`add-subj-${s}`}
                          type="button"
                          disabled={isPrimary}
                          onClick={() =>
                            setGuruMapelList((prev) =>
                              prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                            )
                          }
                          className={`btn-press rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                            isSelected
                              ? 'bg-emerald-700 text-white shadow-xs'
                              : 'border border-white/65 bg-white/50 text-slate-700 hover:bg-white/85'
                          } ${isPrimary ? 'opacity-90 cursor-default' : ''}`}
                        >
                          {s}{isPrimary ? ' (Utama)' : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {guruFormError && (
                <div className="rounded-xl border border-red-300/70 bg-red-500/15 px-3.5 py-2 text-xs font-medium text-red-900">
                  {guruFormError}
                </div>
              )}

              <button
                type="submit"
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
              >
                <Plus className="h-4 w-4" />
                <span>Simpan Akun Guru</span>
              </button>
            </form>

            {/* Masked Teacher Table - ZERO reveal icons, permanent •••••••• */}
            <div className="surface-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/50 px-4 py-3">
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={guruSearch}
                    onChange={(e) => setGuruSearch(e.target.value)}
                    placeholder="Cari nama guru atau mapel..."
                    className="glass-input w-full rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <span className="font-mono-tabular text-xs text-slate-600">
                  {filteredTeachers.length} akun guru
                </span>
              </div>
              {/* Mobile Card View (< md) */}
              <div className="md:hidden divide-y divide-white/50">
                {filteredTeachers.map((t) => (
                  <div key={`mob-tchr-${t.id}`} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm text-slate-900 truncate">{t.nama}</p>
                        <p className="text-xs text-slate-600">
                          {getTeacherSubjects(t).join(', ')}
                        </p>
                      </div>
                      <span
                        className={`text-xs font-bold shrink-0 ${
                          t.aktif ? 'text-emerald-800' : 'text-slate-500'
                        }`}
                      >
                        {t.aktif ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="font-mono-tabular text-[11px] text-slate-500">
                        Kredensial terenkripsi SHA-256
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditTeacherModal(t)}
                          className="btn-press min-h-[40px] inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/65 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-white"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (editingTeacher?.id === t.id) setEditingTeacher(null);
                            await onDeleteTeacher(t.id);
                          }}
                          aria-label={`Hapus guru ${t.nama}`}
                          className="btn-press min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-red-300/70 bg-red-500/10 text-red-700 hover:bg-red-500/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tablet/Desktop Table (>= md) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-white/50 bg-white/35 text-xs font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-3">Nama Lengkap Guru</th>
                      <th className="px-4 py-3">Mata Pelajaran</th>
                      <th className="px-4 py-3">Username</th>
                      <th className="px-4 py-3">Password</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/45">
                    {filteredTeachers.map((t) => (
                      <tr key={t.id} className="hover:bg-white/45 transition-colors">
                        <td className="px-4 py-3 font-medium text-slate-900">{t.nama}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {getTeacherSubjects(t).join(', ')}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-500">••••••••</td>
                        <td className="px-4 py-3 font-mono-tabular text-slate-500">••••••••</td>
                        <td className="px-4 py-3">
                          <span
                            className={`text-xs font-semibold ${
                              t.aktif ? 'text-emerald-800' : 'text-slate-500'
                            }`}
                          >
                            {t.aktif ? 'Aktif' : 'Nonaktif'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditTeacherModal(t)}
                            className="btn-press mr-2 inline-flex items-center gap-1 rounded-xl border border-white/70 bg-white/55 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-white/85"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (editingTeacher?.id === t.id) setEditingTeacher(null);
                              await onDeleteTeacher(t.id);
                            }}
                            aria-label={`Hapus guru ${t.nama}`}
                            className="btn-press inline-flex items-center gap-1 rounded-xl border border-red-300/70 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-500/20"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Hapus</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Edit Teacher Modal (Reset Password Baru masked, never displays old password) */}
            {editingTeacher && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
                role="dialog"
                aria-modal="true"
              >
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const validPrimaryMapel = subjectNames.includes(editGuruMapel)
                      ? editGuruMapel
                      : subjectNames[0] || editGuruMapel || 'Matematika';
                    const combinedSubjects = Array.from(
                      new Set([validPrimaryMapel, ...editGuruMapelList.filter((s) => subjectNames.includes(s))])
                    );
                    const trimmedPass = editGuruNewPassword.trim();
                    await onUpdateTeacher(editingTeacher.id, {
                      nama: editGuruNama.trim(),
                      mataPelajaran: validPrimaryMapel,
                      mataPelajaranList: combinedSubjects,
                      newPassword: trimmedPass || undefined,
                      aktif: editGuruAktif,
                    });
                    setEditingTeacher(null);
                  }}
                  className="glass-modal w-full max-w-md max-h-[90vh] overflow-y-auto p-6 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-base font-bold text-slate-900">Edit Data Guru</h3>
                    <button
                      type="button"
                      onClick={() => setEditingTeacher(null)}
                      className="btn-press rounded-xl p-1 text-slate-500 hover:bg-white/60"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nama Lengkap Guru
                    </label>
                    <input
                      type="text"
                      required
                      value={editGuruNama}
                      onChange={(e) => setEditGuruNama(e.target.value)}
                      className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mata Pelajaran Utama
                    </label>
                    <select
                      value={editGuruMapel}
                      onChange={(e) => setEditGuruMapel(e.target.value)}
                      className="glass-input w-full rounded-xl px-3.5 py-2 text-sm text-slate-900"
                    >
                      {subjectNames.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  {subjectNames.length > 1 && (
                    <div className="glass-subtle rounded-2xl p-3">
                      <p className="text-[11px] font-semibold text-slate-700 mb-2">
                        Daftar Mapel yang Diampu
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {subjectNames.map((s) => {
                          const isPrimary = s === editGuruMapel;
                          const isSelected = isPrimary || editGuruMapelList.includes(s);
                          return (
                            <button
                              key={`edit-subj-${s}`}
                              type="button"
                              disabled={isPrimary}
                              onClick={() =>
                                setEditGuruMapelList((prev) =>
                                  prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                                )
                              }
                              className={`btn-press rounded-xl px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                                isSelected
                                  ? 'bg-emerald-700 text-white shadow-xs'
                                  : 'border border-white/65 bg-white/50 text-slate-700 hover:bg-white/85'
                              } ${isPrimary ? 'opacity-90 cursor-default' : ''}`}
                            >
                              {s}{isPrimary ? ' (Utama)' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Reset Password Baru (Kosongkan jika tidak ingin mengubah)
                    </label>
                    <div className="relative">
                      <input
                        type={showEditGuruPassword ? 'text' : 'password'}
                        value={editGuruNewPassword}
                        onChange={(e) => setEditGuruNewPassword(e.target.value)}
                        placeholder="••••••••"
                        className="glass-input w-full rounded-xl pl-3.5 pr-9 py-2 text-sm text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowEditGuruPassword((v) => !v)}
                        aria-label={showEditGuruPassword ? 'Sembunyikan password' : 'Lihat password'}
                        className="btn-press absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                      >
                        {showEditGuruPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editGuruAktif}
                      onChange={(e) => setEditGuruAktif(e.target.checked)}
                      className="accent-emerald-700"
                    />
                    <span>Akun Guru Aktif</span>
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditingTeacher(null)}
                      className="btn-press rounded-xl border border-white/70 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      className="btn-press rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                    >
                      Simpan Perubahan
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>
        )}

        {/* TAB: BANK SOAL & JADWAL PUSAT */}
        {activeTab === 'bank-jadwal' && (
          <div
            key="bank-jadwal"
            className={tabSlideClass}
            data-admin-tab-panel="bank-jadwal"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<PanelFallback />}>
              <div className="space-y-8">
                <BankSoalPanel
                  questions={questions}
                  subjects={subjectNames}
                  selectedSubject={effectiveAdminMapel}
                  onChangeSubject={setAdminSelectedMapel}
                  teacherName={loggedAdmin.nama}
                  onAddQuestion={onAddQuestion}
                  onUpdateQuestion={onUpdateQuestion}
                  onDeleteQuestion={onDeleteQuestion}
                  onDeleteQuestionsBatch={onDeleteQuestionsBatch}
                  onClearSubjectBank={onClearBankBySubject}
                />

                <JadwalTesPanel
                  exams={exams}
                  questions={questions}
                  subjects={subjectNames}
                  classes={classNames}
                  teacherName={loggedAdmin.nama}
                  onSaveExam={onSaveExam}
                  onToggleExamActive={onToggleExamActive}
                  onDeleteExam={onDeleteExam}
                />
              </div>
            </Suspense>
          </div>
        )}

        {/* TAB: INTEGRATED AI QUESTION STUDIO */}
        {activeTab === 'ai-import' && (
          <div
            key="ai-import"
            className={tabSlideClass}
            data-admin-tab-panel="ai-import"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<PanelFallback />}>
              <SmartImportPanel
                subjects={subjectNames}
                selectedSubject={effectiveAdminMapel}
                onChangeSubject={setAdminSelectedMapel}
                teacherName={loggedAdmin.nama}
                onSaveImportedQuestions={onAddQuestionsBatch}
                onSuccessRedirect={() => setActiveTab('bank-jadwal')}
              />
            </Suspense>
          </div>
        )}

        {/* TAB: LIVE MONITORING ALL PARTICIPANTS */}
        {activeTab === 'monitoring' && (
          <div
            key="monitoring"
            className={tabSlideClass}
            data-admin-tab-panel="monitoring"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<PanelFallback />}>
              <LiveMonitoringGrid
                sessions={liveStreams}
                onSendWarning={onSendProctorWarning}
                emptyTitle="Belum ada peserta ujian yang sedang aktif di seluruh mata pelajaran."
              />
            </Suspense>
          </div>
        )}

        {/* TAB: REKAP NILAI SEMUA MAPEL */}
        {activeTab === 'rekap' && (
          <div
            key="rekap"
            className={tabSlideClass}
            data-admin-tab-panel="rekap"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<PanelFallback />}>
              <ResultsPanel
                key={rekapPresetStatus}
                results={results}
                exams={exams}
                subjects={subjectNames}
                classes={classNames}
                initialStatusFilter={rekapPresetStatus}
                onUpdateEssayScore={onUpdateEssayScore}
                onDeleteResult={onDeleteResult}
                onOpenGoogleSheets={onOpenGoogleSheets}
              />
            </Suspense>
          </div>
        )}

        {/* TAB: LOG SINKRONISASI REAL-TIME */}
        {activeTab === 'log-sinkron' && (
          <div
            key="log-sinkron"
            className={tabSlideClass}
            data-admin-tab-panel="log-sinkron"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<PanelFallback />}>
              <SyncLogsPanel
                logs={syncLogs}
                syncInfo={syncInfo}
                onForceSync={onForceSync}
                onOpenDiagnostics={onOpenDiagnostics}
              />
            </Suspense>
          </div>
        )}
      </section>
    </div>
  );
};
