import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Sparkles,
  Calendar,
  Video,
  ClipboardCheck,
  LogOut,
  PlayCircle,
  Compass,
  Lock,
  ArrowRight,
  ArrowUpRight,
  FileText,
  ShieldAlert,
  CheckCircle2,
  Plus,
  Download,
  FileSpreadsheet,
  Radio,
  Eye,
  EyeOff,
} from 'lucide-react';
import type {
  ClassItem,
  ExamResult,
  ExamSchedule,
  LiveStreamSession,
  Question,
  SubjectItem,
  SyncStatusInfo,
  TeacherAccount,
} from '../types/cbt';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { exportExamResultsToExcel } from '../utils/exportHelpers';
import { getTeacherSubjects } from '../utils/storeSyncUtils';
import { useActiveMotionFlag, useLiquidMorphPill, useTabSlideDirection } from '../hooks/useLiquidMotion';
import type { TeacherTab } from './TeacherTutorAssistant';

const TEACHER_TAB_ORDER: readonly TeacherTab[] = [
  'analitik',
  'bank-soal',
  'import',
  'jadwal',
  'monitoring',
  'hasil',
];

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
const SmartImportPanel = lazy(() =>
  import('./SmartImportPanel').then((m) => ({ default: m.SmartImportPanel }))
);
const ResultsPanel = lazy(() =>
  import('./ResultsPanel').then((m) => ({ default: m.ResultsPanel }))
);
const TeacherTutorAssistant = lazy(() =>
  import('./TeacherTutorAssistant').then((m) => ({ default: m.TeacherTutorAssistant }))
);
const VideoTutorialModal = lazy(() =>
  import('./VideoTutorialModal').then((m) => ({ default: m.VideoTutorialModal }))
);

const TabLoading = () => (
  <div className="surface-card p-8 text-center text-xs text-slate-500">
    Memuat modul...
  </div>
);

interface TeacherPortalProps {
  loggedTeacher: TeacherAccount | null;
  onSetLoggedTeacher: (t: TeacherAccount | null) => void;
  subjects: SubjectItem[];
  classes: ClassItem[];
  questions: Question[];
  exams: ExamSchedule[];
  results: ExamResult[];
  liveStreams: LiveStreamSession[];
  onAuthenticate: (username: string, password: string) => Promise<TeacherAccount | null>;
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
  activeTab?: TeacherTab;
  onActiveTabChange?: (tab: TeacherTab) => void;
  externalCreateQuestionSignal?: number;
  onOpenGoogleSheets?: (targetResults: ExamResult[], defaultTitle?: string) => void;
  syncInfo: SyncStatusInfo;
  onForceSync?: () => Promise<void>;
}

export const TeacherPortal: React.FC<TeacherPortalProps> = ({
  loggedTeacher,
  onSetLoggedTeacher,
  subjects,
  classes,
  questions,
  exams,
  results,
  liveStreams,
  onAuthenticate,
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
  activeTab: controlledTab,
  onActiveTabChange,
  externalCreateQuestionSignal,
  onOpenGoogleSheets,
  syncInfo,
  onForceSync,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [internalTab, setInternalTab] = useState<TeacherTab>('analitik');
  const activeTab = controlledTab ?? internalTab;
  const setActiveTab = (next: TeacherTab) => {
    if (controlledTab === undefined) setInternalTab(next);
    onActiveTabChange?.(next);
  };
  const [resultsPresetStatus, setResultsPresetStatus] = useState<'ALL' | 'Selesai' | 'Pelanggaran'>('ALL');
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState<number | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [createQuestionSignal, setCreateQuestionSignal] = useState(0);
  const [exportStatusMsg, setExportStatusMsg] = useState<string | null>(null);
  const [selectedTeacherSubject, setSelectedTeacherSubject] = useState('');
  const mobNavRef = useRef<HTMLElement | null>(null);
  const deskNavRef = useRef<HTMLElement | null>(null);
  const tabSlideDirection = useTabSlideDirection(TEACHER_TAB_ORDER, activeTab);
  const tabMotion = useActiveMotionFlag(activeTab, 400);
  const tabSlideClass =
    tabSlideDirection === 'forward'
      ? 'tab-slide-forward'
      : tabSlideDirection === 'backward'
        ? 'tab-slide-backward'
        : 'tab-slide-up';
  const navMorphSignature = `${loggedTeacher?.id ?? 'out'}-${selectedTeacherSubject}-${questions.length}-${exams.length}-${liveStreams.length}-${results.length}`;
  const mobMorph = useLiquidMorphPill(mobNavRef, loggedTeacher ? activeTab : null, navMorphSignature);
  const deskMorph = useLiquidMorphPill(deskNavRef, loggedTeacher ? activeTab : null, navMorphSignature);

  useEffect(() => {
    if (externalCreateQuestionSignal && externalCreateQuestionSignal > 0) {
      setCreateQuestionSignal((c) => c + 1);
    }
  }, [externalCreateQuestionSignal]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    if (!username.trim() || !password) {
      setLoginError('Masukkan username dan password akun guru.');
      return;
    }
    const found = await onAuthenticate(username, password);
    if (!found) {
      setLoginError('Username atau password tidak cocok, atau akun sedang dinonaktifkan.');
      return;
    }
    onSetLoggedTeacher(found);
    setUsername('');
    setPassword('');
  };

  // STRICT PRIVACY: Clean 2-Column Login Card with ZERO demo credentials / quick-login hints
  if (!loggedTeacher) {
    return (
      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-12 panel-enter">
        <div className="surface-card rounded-3xl overflow-hidden grid grid-cols-1 md:grid-cols-12 items-stretch">
          <div className="glass-dark md:col-span-5 p-7 sm:p-8 text-white flex flex-col justify-between border-0 border-b md:border-b-0 md:border-r border-white/15">
            <div>
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/35 text-emerald-300">
                <Lock className="h-5 w-5" />
              </span>
              <p className="mt-5 text-xs font-semibold text-emerald-300">
                Portal Pengajar &middot; MTs Nurul Hijrah
              </p>
              <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
                Workspace Guru CBT
              </h1>
              <p className="mt-2 text-xs leading-relaxed text-slate-200">
                Kelola bank soal terstruktur, impor dokumen cerdas, pantau kamera peserta secara langsung, dan nilai jawaban esai dalam satu ruang kerja.
              </p>
            </div>

            <ul className="mt-6 space-y-2.5 border-t border-white/15 pt-5 text-xs text-slate-200">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Bank soal PG, Kompleks, B/S &amp; Esai</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Live Proctoring kamera &amp; mikrofon</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-300 shrink-0" />
                <span>Koreksi esai &amp; rekap nilai instan</span>
              </li>
            </ul>
          </div>

          <form onSubmit={handleLogin} className="md:col-span-7 p-7 sm:p-8 flex flex-col justify-center space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Masuk Akun Guru
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Gunakan kredensial akun guru yang terdaftar pada sistem sekolah.
              </p>
            </div>

            <div>
              <label htmlFor="guru-username" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Username
              </label>
              <input
                id="guru-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Masukkan username guru"
                className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="guru-password" className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  id="guru-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  className="glass-input w-full rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                  className="btn-press absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
              className="btn-press w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800 shadow-[0_10px_24px_-10px_rgba(4,120,87,0.55)]"
            >
              Masuk ke Dashboard Guru
            </button>
          </form>
        </div>
      </main>
    );
  }

  const subjectNames = subjects.map((s) => s.nama);
  const classNames = classes.map((c) => c.nama);
  const teacherSubjects = getTeacherSubjects(loggedTeacher);
  const teacherSubject = teacherSubjects.includes(selectedTeacherSubject)
    ? selectedTeacherSubject
    : teacherSubjects[0] || loggedTeacher.mataPelajaran;

  const subjectQuestions = questions.filter((q) => q.mataPelajaran === teacherSubject);
  const subjectExams = exams.filter((e) => e.mataPelajaran === teacherSubject);
  const activeSubjectExams = subjectExams.filter((e) => e.aktif);
  const subjectResults = results.filter((r) => r.mataPelajaran === teacherSubject);
  const subjectLiveStreams = liveStreams.filter((s) => s.mataPelajaran === teacherSubject);
  const activeLiveCount = subjectLiveStreams.filter((s) => s.status === 'aktif').length;

  const qCounts = {
    pg: subjectQuestions.filter((q) => q.tipe === 'PG').length,
    pgk: subjectQuestions.filter((q) => q.tipe === 'PG_KOMPLEKS').length,
    bs: subjectQuestions.filter((q) => q.tipe === 'BENAR_SALAH').length,
    esai: subjectQuestions.filter((q) => q.tipe === 'ESAI').length,
  };
  const recentResults = [...subjectResults]
    .sort((a, b) => new Date(b.waktuSubmit).getTime() - new Date(a.waktuSubmit).getTime())
    .slice(0, 5);

  const navItems: Array<{
    id: TeacherTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }> = [
    { id: 'analitik', label: 'Dashboard & Analitik', icon: <BarChart3 className="h-4 w-4" /> },
    {
      id: 'bank-soal',
      label: 'Data Modul / Bank Soal',
      icon: <BookOpen className="h-4 w-4" />,
      count: subjectQuestions.length,
    },
    { id: 'import', label: 'Import Soal AI', icon: <Sparkles className="h-4 w-4" /> },
    {
      id: 'jadwal',
      label: 'Data Tes / Jadwal Ujian',
      icon: <Calendar className="h-4 w-4" />,
      count: subjectExams.length,
    },
    {
      id: 'monitoring',
      label: 'Live Monitoring Ujian',
      icon: <Video className="h-4 w-4" />,
      count: activeLiveCount,
    },
    {
      id: 'hasil',
      label: 'Hasil Tes & Koreksi Esai',
      icon: <ClipboardCheck className="h-4 w-4" />,
      count: subjectResults.length,
    },
  ];

  const activeNav = navItems.find((n) => n.id === activeTab);
  const teacherInitials = loggedTeacher.nama
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  return (
    <div className="mx-auto flex max-w-7xl flex-col lg:flex-row gap-4 lg:gap-6 px-3.5 sm:px-6 py-4 sm:py-6 panel-enter">
      {/* Executive Dark Glass Sidebar (Compact on Phone/Tablet, Sticky Rail on Laptop/Desktop) */}
      <aside className="w-full lg:w-64 shrink-0 space-y-3 lg:space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="glass-dark rounded-3xl p-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 border border-emerald-400/35 font-display text-sm font-bold text-emerald-300">
                {teacherInitials || 'GR'}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
                  Guru Pengampu
                </p>
                <h2 className="truncate font-display text-sm font-bold leading-snug">
                  {loggedTeacher.nama}
                </h2>
                {teacherSubjects.length > 1 ? (
                  <select
                    aria-label="Pilih Mata Pelajaran Ampuan"
                    value={teacherSubject}
                    onChange={(e) => setSelectedTeacherSubject(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/25 bg-white/10 px-2 py-1 text-[11px] font-semibold text-emerald-200 focus:outline-none"
                  >
                    {teacherSubjects.map((subj) => (
                      <option key={subj} value={subj} className="bg-slate-900 text-white">
                        {subj}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="truncate text-xs text-slate-300">{teacherSubject}</p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onSetLoggedTeacher(null)}
              aria-label="Keluar Akun Guru"
              className="btn-press lg:hidden min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Keluar</span>
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3 text-left">
            <button
              type="button"
              onClick={() => setActiveTab('bank-soal')}
              className="btn-press min-h-[44px] rounded-xl bg-white/10 border border-white/15 px-2.5 py-2 hover:bg-white/15"
            >
              <p className="text-[10px] text-slate-300">Bank Soal</p>
              <p className="font-mono-tabular text-sm font-bold text-white">
                {subjectQuestions.length}
              </p>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('jadwal')}
              className="btn-press min-h-[44px] rounded-xl bg-white/10 border border-white/15 px-2.5 py-2 hover:bg-white/15"
            >
              <p className="text-[10px] text-slate-300">Jadwal Aktif</p>
              <p className="font-mono-tabular text-sm font-bold text-emerald-300">
                {activeSubjectExams.length}
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
            onClick={() => onSetLoggedTeacher(null)}
            className="btn-press hidden lg:inline-flex mt-3 w-full items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Keluar Akun</span>
          </button>
        </div>

        {/* Mobile & Tablet Horizontal Scrollable Tab Strip (< lg) */}
        <nav
          ref={mobNavRef}
          aria-label="Menu Portal Guru Mobile"
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
                  if (item.id === 'hasil') setResultsPresetStatus('ALL');
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
          aria-label="Menu Portal Guru Desktop"
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
            const isWalkHighlight =
              (walkthroughStep === 0 && item.id === 'bank-soal') ||
              (walkthroughStep === 1 && item.id === 'import') ||
              ((walkthroughStep === 2 || walkthroughStep === 3) && item.id === 'jadwal');
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                data-morph-active={isActive ? 'true' : undefined}
                onClick={() => {
                  if (item.id === 'hasil') setResultsPresetStatus('ALL');
                  setActiveTab(item.id);
                }}
                className={`btn-press relative z-10 flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition-colors duration-200 ${
                  isActive
                    ? deskMorph.visible
                      ? 'text-white'
                      : 'bg-emerald-700 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/45 hover:text-slate-950'
                } ${isWalkHighlight ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
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
              Portal Guru &middot; {teacherSubject}
            </p>
            <h1 className="font-display text-base sm:text-lg font-bold text-slate-900 truncate">
              {activeNav?.label}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SyncStatusIndicator
              syncInfo={syncInfo}
              onForceSync={onForceSync}
              variant="banner"
            />
            <button
              type="button"
              onClick={() => {
                setActiveTab('bank-soal');
                setCreateQuestionSignal((c) => c + 1);
              }}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 shadow-[0_10px_22px_-10px_rgba(4,120,87,0.5)]"
            >
              <Plus className="h-4 w-4" />
              <span>Tambah Soal</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (subjectResults.length === 0) {
                  setExportStatusMsg(`Belum ada nilai ${teacherSubject} untuk diekspor.`);
                  window.setTimeout(() => setExportStatusMsg(null), 3200);
                  return;
                }
                void exportExamResultsToExcel(
                  subjectResults,
                  `Rekap_Nilai_${teacherSubject.replace(/\s+/g, '_')}`
                );
              }}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-white/95 whitespace-nowrap shrink-0"
            >
              <Download className="h-4 w-4 text-emerald-700" />
              <span>Ekspor Nilai</span>
            </button>
            {onOpenGoogleSheets && (
              <button
                type="button"
                onClick={() =>
                  onOpenGoogleSheets(
                    subjectResults,
                    `Rekap Nilai ${teacherSubject} CBT MTs Nurul Hijrah`
                  )
                }
                className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-300/75 bg-white/75 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-white whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
                <span>Google Sheets</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setTutorOpen((o) => !o)}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white/85 whitespace-nowrap shrink-0"
            >
              <Sparkles className="h-4 w-4 text-emerald-700" />
              <span>Panduan Buat Soal</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('bank-soal');
                setWalkthroughStep(0);
              }}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white/85 whitespace-nowrap shrink-0"
            >
              <Compass className="h-4 w-4 text-emerald-700" />
              <span>Tur Panduan</span>
            </button>
            <button
              type="button"
              onClick={() => setVideoModalOpen(true)}
              className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-white/85 whitespace-nowrap shrink-0"
            >
              <PlayCircle className="h-4 w-4 text-emerald-700" />
              <span>Video Tutorial</span>
            </button>
          </div>
        </div>

        {exportStatusMsg && (
          <div className="glass-subtle rounded-2xl border-amber-300/60 bg-amber-500/12 px-4 py-2.5 text-xs font-medium text-amber-950">
            {exportStatusMsg}
          </div>
        )}

        {activeTab === 'analitik' && (
          <div
            key="analitik"
            className={`space-y-6 ${tabSlideClass}`}
            data-teacher-tab-panel="analitik"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            {/* Indikator Status Ujian Frosted Glass Strip */}
            <div className="surface-card rounded-3xl p-4 sm:p-5 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                <span
                  className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
                    activeSubjectExams.length > 0
                      ? 'border-emerald-400/55 bg-emerald-500/15 text-emerald-800'
                      : 'border-white/70 bg-white/60 text-slate-600'
                  }`}
                >
                  <Radio className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      Status Ujian Mapel
                    </span>
                    <span
                      className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-bold ${
                        activeSubjectExams.length > 0
                          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-900'
                          : 'border-slate-300/70 bg-white/60 text-slate-700'
                      }`}
                    >
                      {activeSubjectExams.length > 0
                        ? `Aktif • ${activeSubjectExams.length} Jadwal Dibuka`
                        : 'Siaga • Belum Ada Jadwal Dibuka'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-700">
                    {activeSubjectExams.length > 0
                      ? `Token aktif: ${activeSubjectExams
                          .slice(0, 2)
                          .map((e) => `${e.judulUjian} (${e.token})`)
                          .join(' · ')} • ${activeLiveCount} peserta sedang mengerjakan.`
                      : `Terdapat ${subjectExams.length} jadwal tersimpan untuk ${teacherSubject}. Aktifkan jadwal agar siswa dapat masuk ujian.`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('jadwal')}
                  className="btn-press rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-white whitespace-nowrap"
                >
                  Atur Status Jadwal
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('monitoring')}
                  className="btn-press rounded-xl bg-emerald-700 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
                >
                  Live ({activeLiveCount})
                </button>
              </div>
            </div>

            {/* Interactive Quick Workflow Launcher */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('bank-soal')}
                className="surface-card-interactive p-3.5 text-left flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">Susun Bank Soal</p>
                  <p className="text-[11px] text-slate-500 font-mono-tabular">
                    {subjectQuestions.length} butir tersedia
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-[transform,color] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('import')}
                className="surface-card-interactive p-3.5 text-left flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">Import Word / AI</p>
                  <p className="text-[11px] text-slate-500 truncate">Tabel &amp; gambar utuh</p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-[transform,color] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('jadwal')}
                className="surface-card-interactive p-3.5 text-left flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">Atur Jadwal &amp; Token</p>
                  <p className="text-[11px] text-slate-500 font-mono-tabular">
                    {activeSubjectExams.length} jadwal dibuka
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-[transform,color] shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('monitoring')}
                className="surface-card-interactive p-3.5 text-left flex items-center justify-between gap-2 group"
              >
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">Pantau Kamera Live</p>
                  <p className="text-[11px] text-slate-500 font-mono-tabular">
                    {activeLiveCount} peserta aktif
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-700 group-hover:translate-x-0.5 transition-[transform,color] shrink-0" />
              </button>
            </div>

            {/* Interactive Bank Soal Composition & Recent Follow-ups Split */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Composition Card */}
              <div className="lg:col-span-5 surface-card p-5 flex flex-col justify-between gap-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Komposisi Bank Soal {teacherSubject}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Klik jenis soal untuk membuka daftar butir di Bank Soal.
                    </p>
                  </div>
                  <FileText className="h-4 w-4 text-emerald-700 shrink-0" />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Pilihan Ganda', count: qCounts.pg, accent: 'bg-emerald-600' },
                    { label: 'PG Kompleks', count: qCounts.pgk, accent: 'bg-sky-600' },
                    { label: 'Benar / Salah', count: qCounts.bs, accent: 'bg-slate-700' },
                    { label: 'Esai / Uraian', count: qCounts.esai, accent: 'bg-amber-600' },
                  ].map((item) => {
                    const pct =
                      subjectQuestions.length > 0
                        ? Math.round((item.count / subjectQuestions.length) * 100)
                        : 0;
                    return (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => setActiveTab('bank-soal')}
                        className="btn-press glass-subtle rounded-2xl p-3 text-left hover:bg-white/75 transition-colors"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-600">
                          <span className="truncate">{item.label}</span>
                          <span className="font-mono-tabular font-semibold">{pct}%</span>
                        </div>
                        <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900">
                          {item.count}
                        </p>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/65">
                          <div className={`h-full ${item.accent}`} style={{ width: `${pct}%` }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Recent Submissions & Quick Review Queue */}
              <div className="lg:col-span-7 surface-card p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Aktivitas &amp; Tindak Lanjut Terbaru
                    </h3>
                    <p className="text-xs text-slate-600">
                      Peserta yang baru mengumpulkan atau memerlukan pemeriksaan esai/pelanggaran.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setResultsPresetStatus('ALL');
                      setActiveTab('hasil');
                    }}
                    className="btn-press inline-flex items-center gap-1 rounded-xl px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-white/60 whitespace-nowrap shrink-0"
                  >
                    <span>Lihat Semua</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {recentResults.length === 0 ? (
                  <div className="glass-subtle rounded-2xl border-dashed p-6 text-center text-xs text-slate-600">
                    Belum ada kiriman jawaban siswa untuk mata pelajaran {teacherSubject}.
                  </div>
                ) : (
                  <div className="divide-y divide-white/50">
                    {recentResults.map((res) => {
                      const needsEssayReview =
                        res.jawabanDetail.some((d) => d.tipe === 'ESAI') && res.skorEsai === 0;
                      const isViolation = res.status === 'Pelanggaran';
                      return (
                        <div
                          key={res.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate">{res.namaSiswa}</p>
                            <p className="text-[11px] text-slate-600 truncate">
                              {res.kelas} &middot; {res.judulUjian}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono-tabular text-sm font-bold text-slate-900">
                              {res.nilaiAkhir}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setResultsPresetStatus(isViolation ? 'Pelanggaran' : 'ALL');
                                setActiveTab('hasil');
                              }}
                              className={`btn-press inline-flex items-center gap-1 rounded-xl border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${
                                isViolation
                                  ? 'border-red-300/70 bg-red-500/15 text-red-800 hover:bg-red-500/25'
                                  : needsEssayReview
                                    ? 'border-amber-300/70 bg-amber-500/15 text-amber-900 hover:bg-amber-500/25'
                                    : 'border-white/70 bg-white/55 text-slate-800 hover:bg-white/85'
                              }`}
                            >
                              {isViolation && <ShieldAlert className="h-3 w-3" />}
                              <span>
                                {isViolation
                                  ? 'Tinjau Pelanggaran'
                                  : needsEssayReview
                                    ? 'Periksa Esai'
                                    : 'Detail Nilai'}
                              </span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <Suspense fallback={<TabLoading />}>
              <TeacherAnalytics
                results={subjectResults}
                title={`Analitik Nilai & Performa Kelas — ${teacherSubject}`}
                onNavigateResults={(presetStatus) => {
                  setResultsPresetStatus(presetStatus || 'ALL');
                  setActiveTab('hasil');
                }}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'bank-soal' && (
          <div
            key="bank-soal"
            className={tabSlideClass}
            data-teacher-tab-panel="bank-soal"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<TabLoading />}>
              <BankSoalPanel
                questions={questions}
                subjects={subjectNames}
                selectedSubject={teacherSubject}
                onChangeSubject={() => {}}
                lockedSubject={teacherSubject}
                teacherName={loggedTeacher.nama}
                onAddQuestion={onAddQuestion}
                onUpdateQuestion={onUpdateQuestion}
                onDeleteQuestion={onDeleteQuestion}
                onDeleteQuestionsBatch={onDeleteQuestionsBatch}
                onClearSubjectBank={onClearBankBySubject}
                onOpenVideoTutorial={() => setVideoModalOpen(true)}
                openCreateSignal={createQuestionSignal}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'import' && (
          <div
            key="import"
            className={tabSlideClass}
            data-teacher-tab-panel="import"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<TabLoading />}>
              <SmartImportPanel
                subjects={subjectNames}
                selectedSubject={teacherSubject}
                onChangeSubject={() => {}}
                lockedSubject={teacherSubject}
                teacherName={loggedTeacher.nama}
                onSaveImportedQuestions={onAddQuestionsBatch}
                onSuccessRedirect={() => setActiveTab('bank-soal')}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'jadwal' && (
          <div
            key="jadwal"
            className={tabSlideClass}
            data-teacher-tab-panel="jadwal"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<TabLoading />}>
              <JadwalTesPanel
                exams={exams}
                questions={questions}
                subjects={subjectNames}
                classes={classNames}
                lockedSubject={teacherSubject}
                teacherName={loggedTeacher.nama}
                onSaveExam={onSaveExam}
                onToggleExamActive={onToggleExamActive}
                onDeleteExam={onDeleteExam}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'monitoring' && (
          <div
            key="monitoring"
            className={tabSlideClass}
            data-teacher-tab-panel="monitoring"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<TabLoading />}>
              <LiveMonitoringGrid
                sessions={subjectLiveStreams}
                onSendWarning={onSendProctorWarning}
                emptyTitle={`Belum ada siswa yang sedang ujian mata pelajaran ${teacherSubject}.`}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'hasil' && (
          <div
            key="hasil"
            className={tabSlideClass}
            data-teacher-tab-panel="hasil"
            data-motion-active={tabMotion.motionActive ? 'true' : undefined}
            onAnimationEnd={tabMotion.onAnimationEnd}
          >
            <Suspense fallback={<TabLoading />}>
              <ResultsPanel
                key={resultsPresetStatus}
                results={subjectResults}
                exams={exams}
                subjects={subjectNames}
                classes={classNames}
                lockedSubject={teacherSubject}
                initialStatusFilter={resultsPresetStatus}
                onUpdateEssayScore={onUpdateEssayScore}
                onOpenGoogleSheets={onOpenGoogleSheets}
              />
            </Suspense>
          </div>
        )}
      </section>

      <Suspense fallback={null}>
        <TeacherTutorAssistant
          open={tutorOpen}
          onOpenChange={setTutorOpen}
          onNavigateTab={setActiveTab}
          walkthroughStep={walkthroughStep}
          onStartWalkthrough={() => setWalkthroughStep(0)}
          onNextWalkthrough={() =>
            setWalkthroughStep((s) => (s === null ? 0 : s + 1))
          }
          onCloseWalkthrough={() => setWalkthroughStep(null)}
        />
      </Suspense>

      {videoModalOpen && (
        <Suspense fallback={null}>
          <VideoTutorialModal open={videoModalOpen} onClose={() => setVideoModalOpen(false)} />
        </Suspense>
      )}
    </div>
  );
};
