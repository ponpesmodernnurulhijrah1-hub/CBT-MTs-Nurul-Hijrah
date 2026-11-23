import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, RefreshCw, WifiOff } from 'lucide-react';
import type { AdminAccount, ExamResult, TeacherAccount, UserRole } from './types/cbt';
import { useCbtStore } from './hooks/useCbtStore';
import { useAppUpdater } from './hooks/useAppUpdater';
import { usePWAInstall } from './hooks/usePWAInstall';
import { TopBar } from './components/TopBar';
import { StudentPortal } from './components/StudentPortal';
import { VirtualPetAssistant, type PetActivitySignal } from './components/VirtualPetAssistant';
import { exportExamResultsToExcel } from './utils/exportHelpers';
import { getTeacherSubjects } from './utils/storeSyncUtils';
import {
  SW_HEARTBEAT_INTERVAL_MS,
  shouldSoftReloadFromSwHeartbeat,
} from './utils/updaterLogic';
import { syncDocumentDeviceAttributes } from './utils/deviceViewport';
import type { TeacherTab } from './components/TeacherTutorAssistant';
import type { AdminTab } from './components/AdminPortal';
import type { PetActivityEvent, PetAppContextSummary, PetClientAction } from './utils/virtualPetUtils';

const QRInstallModal = lazy(() =>
  import('./components/QRInstallModal').then((m) => ({ default: m.QRInstallModal }))
);
const GoogleSheetsExportModal = lazy(() =>
  import('./components/GoogleSheetsExportModal').then((m) => ({
    default: m.GoogleSheetsExportModal,
  }))
);
const TeacherPortal = lazy(() =>
  import('./components/TeacherPortal').then((m) => ({ default: m.TeacherPortal }))
);
const AdminPortal = lazy(() =>
  import('./components/AdminPortal').then((m) => ({ default: m.AdminPortal }))
);
const VersionDiagnosticModal = lazy(() =>
  import('./components/VersionDiagnosticModal').then((m) => ({
    default: m.VersionDiagnosticModal,
  }))
);

const PortalLoader = () => (
  <div className="mx-auto max-w-4xl px-6 py-16 text-center">
    <div className="surface-card inline-block px-6 py-4 text-sm font-medium text-slate-600">
      Memuat panel portal...
    </div>
  </div>
);

const TEACHER_TABS: TeacherTab[] = ['analitik', 'bank-soal', 'import', 'jadwal', 'monitoring', 'hasil'];
const ADMIN_TABS: AdminTab[] = [
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

export default function App() {
  const [activeRole, setActiveRole] = useState<UserRole>('siswa');
  const [isExamLocked, setIsExamLocked] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [diagModalOpen, setDiagModalOpen] = useState(false);
  const [loggedTeacher, setLoggedTeacher] = useState<TeacherAccount | null>(null);
  const [loggedAdmin, setLoggedAdmin] = useState<AdminAccount | null>(null);
  const [teacherTab, setTeacherTab] = useState<TeacherTab>('analitik');
  const [adminTab, setAdminTab] = useState<AdminTab>('ringkasan');
  const [externalCreateQuestionSignal, setExternalCreateQuestionSignal] = useState(0);
  const [petActivitySignal, setPetActivitySignal] = useState<PetActivitySignal | null>(null);
  const [googleSheetsState, setGoogleSheetsState] = useState<{
    open: boolean;
    results: ExamResult[];
    defaultTitle?: string;
  }>({ open: false, results: [] });
  const [studentPrefill, setStudentPrefill] = useState<{
    id: number;
    namaSiswa?: string;
    kelas?: string;
    mataPelajaran?: string;
    token?: string;
  } | null>(null);

  const activeActorName =
    activeRole === 'admin'
      ? loggedAdmin?.nama || 'Administrator'
      : activeRole === 'guru'
        ? loggedTeacher?.nama || 'Guru'
        : 'Peserta Ujian';
  const store = useCbtStore(activeRole, activeActorName);
  const {
    updateAvailable,
    isReloading,
    isCheckingUpdate,
    currentVersion,
    currentBuildHash,
    diagnostics,
    refreshDiagnostics,
    checkAndApplyUpdateNow,
    forceHardResetAndReload,
  } = useAppUpdater(isExamLocked, store.pulseAppVersion, store.pulseBuildHash);
  const pwaInstall = usePWAInstall();
  const [updateCheckStatus, setUpdateCheckStatus] = useState<string | null>(null);
  const statusClearTimerRef = useRef<number | null>(null);
  const isExamLockedRef = useRef(isExamLocked);
  const pendingHeartbeatReloadRef = useRef<{ swVersion?: string; swBuildHash?: string } | null>(null);

  useEffect(() => {
    isExamLockedRef.current = isExamLocked;
    if (!isExamLocked && pendingHeartbeatReloadRef.current) {
      pendingHeartbeatReloadRef.current = null;
      void checkAndApplyUpdateNow(true);
    }
  }, [isExamLocked, checkAndApplyUpdateNow]);

  // 30-minute Service Worker version heartbeat via navigator.serviceWorker.controller.postMessage
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    let cancelled = false;
    const activeTimeouts = new Set<number>();
    const activePorts = new Set<MessagePort>();

    const handleHeartbeatMismatch = (swVersion?: string, swBuildHash?: string) => {
      if (cancelled) return;
      let alreadyReloadedForSwHash: string | null = null;
      if (swBuildHash) {
        try {
          alreadyReloadedForSwHash = window.sessionStorage.getItem(
            `cbt_sw_heartbeat_reloaded_${swBuildHash}`
          );
        } catch {
          // Ignore sessionStorage restrictions
        }
      }

      const mismatch = shouldSoftReloadFromSwHeartbeat({
        clientVersion: currentVersion,
        clientBuildHash: currentBuildHash,
        swVersion,
        swBuildHash,
        alreadyReloadedForSwHash,
      });
      if (!mismatch) return;

      if (swBuildHash) {
        try {
          window.sessionStorage.setItem(`cbt_sw_heartbeat_reloaded_${swBuildHash}`, '1');
        } catch {
          // Ignore sessionStorage restrictions
        }
      }

      if (isExamLockedRef.current) {
        pendingHeartbeatReloadRef.current = { swVersion, swBuildHash };
        return;
      }

      void checkAndApplyUpdateNow(true);
    };

    const pingServiceWorkerHeartbeat = () => {
      if (cancelled) return;
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;

      try {
        const channel = new MessageChannel();
        activePorts.add(channel.port1);

        const timeoutId = window.setTimeout(() => {
          activeTimeouts.delete(timeoutId);
          activePorts.delete(channel.port1);
          try {
            channel.port1.close();
          } catch {
            // Ignore close errors
          }
        }, 3000);
        activeTimeouts.add(timeoutId);

        channel.port1.onmessage = (event: MessageEvent) => {
          window.clearTimeout(timeoutId);
          activeTimeouts.delete(timeoutId);
          activePorts.delete(channel.port1);
          try {
            channel.port1.close();
          } catch {
            // Ignore close errors
          }

          const data = event.data as {
            type?: string;
            version?: string;
            buildHash?: string;
          } | null;
          if (!data || data.type !== 'VERSION_HEARTBEAT_REPLY') return;
          handleHeartbeatMismatch(
            typeof data.version === 'string' ? data.version : undefined,
            typeof data.buildHash === 'string' ? data.buildHash : undefined
          );
        };

        controller.postMessage(
          {
            type: 'PING_VERSION_HEARTBEAT',
            clientVersion: currentVersion,
            clientBuildHash: currentBuildHash,
          },
          [channel.port2]
        );
      } catch {
        // Ignore postMessage failures when SW is transitioning
      }
    };

    const heartbeatIntervalId = window.setInterval(
      pingServiceWorkerHeartbeat,
      SW_HEARTBEAT_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(heartbeatIntervalId);
      activeTimeouts.forEach((id) => window.clearTimeout(id));
      activeTimeouts.clear();
      activePorts.forEach((port) => {
        try {
          port.close();
        } catch {
          // Ignore close errors
        }
      });
      activePorts.clear();
    };
  }, [currentVersion, currentBuildHash, checkAndApplyUpdateNow]);

  useEffect(() => {
    return () => {
      if (statusClearTimerRef.current !== null) {
        window.clearTimeout(statusClearTimerRef.current);
      }
    };
  }, []);

  // Dynamically synchronize responsive viewport meta & device attributes on installed PWAs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let rafId: number | null = null;
    const handleViewportSync = () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        syncDocumentDeviceAttributes();
      });
    };

    syncDocumentDeviceAttributes();
    window.addEventListener('resize', handleViewportSync, { passive: true });
    window.addEventListener('orientationchange', handleViewportSync, { passive: true });
    window.addEventListener('pageshow', handleViewportSync, { passive: true });
    window.visualViewport?.addEventListener('resize', handleViewportSync);

    const standaloneMq = window.matchMedia?.('(display-mode: standalone)');
    if (standaloneMq?.addEventListener) {
      standaloneMq.addEventListener('change', handleViewportSync);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleViewportSync);
      window.removeEventListener('orientationchange', handleViewportSync);
      window.removeEventListener('pageshow', handleViewportSync);
      window.visualViewport?.removeEventListener('resize', handleViewportSync);
      if (standaloneMq?.removeEventListener) {
        standaloneMq.removeEventListener('change', handleViewportSync);
      }
    };
  }, []);

  // Live sync logged-in Teacher & Admin accounts with remote Firestore changes
  useEffect(() => {
    if (!loggedTeacher) return;
    const latest = store.teachers.find((t) => t.id === loggedTeacher.id);
    if (!latest || !latest.aktif) {
      setLoggedTeacher(null);
      return;
    }
    const latestSubjects = getTeacherSubjects(latest);
    const currentSubjects = getTeacherSubjects(loggedTeacher);
    if (
      latest.nama !== loggedTeacher.nama ||
      latest.mataPelajaran !== loggedTeacher.mataPelajaran ||
      JSON.stringify(latestSubjects) !== JSON.stringify(currentSubjects)
    ) {
      setLoggedTeacher({ ...latest, mataPelajaranList: latestSubjects });
    }
  }, [store.teachers, loggedTeacher]);

  useEffect(() => {
    if (!loggedAdmin) return;
    const latest = store.admins.find((a) => a.id === loggedAdmin.id);
    if (latest && latest.nama !== loggedAdmin.nama) {
      setLoggedAdmin(latest);
    }
  }, [store.admins, loggedAdmin]);

  const emitPetActivity = useCallback((event: PetActivityEvent, detail?: string) => {
    setPetActivitySignal({ id: Date.now() + Math.random(), event, detail });
  }, []);

  const openGoogleSheetsModal = useCallback((targetResults: ExamResult[], defaultTitle?: string) => {
    setGoogleSheetsState({
      open: true,
      results: targetResults,
      defaultTitle,
    });
  }, []);

  const petAppContext = useMemo<PetAppContextSummary>(() => {
    const activeExams = store.exams.filter((e) => e.aktif);
    return {
      activeRole,
      isExamLocked,
      isTeacherLoggedIn: Boolean(loggedTeacher),
      teacherName: loggedTeacher?.nama,
      teacherSubject: loggedTeacher?.mataPelajaran,
      isAdminLoggedIn: Boolean(loggedAdmin),
      adminName: loggedAdmin?.nama,
      currentTab: activeRole === 'guru' ? teacherTab : activeRole === 'admin' ? adminTab : 'lobby',
      subjects: store.subjects.map((s) => s.nama),
      classes: store.classes.map((c) => c.nama),
      totalQuestions: store.questions.length,
      activeExamsCount: activeExams.length,
      activeExamsSummary: activeExams.map((e) => ({
        judulUjian: e.judulUjian,
        mataPelajaran: e.mataPelajaran,
        durasiMenit: e.durasiMenit,
        token: loggedTeacher || loggedAdmin ? e.token : undefined,
        jumlahSoal: e.questionsSnapshot.length,
      })),
      totalResults: store.results.length,
      activeLiveCount: store.liveStreams.filter((s) => s.status === 'aktif').length,
    };
  }, [activeRole, isExamLocked, loggedTeacher, loggedAdmin, teacherTab, adminTab, store]);

  const executePetAction = useCallback(
    async (action: PetClientAction): Promise<string | void> => {
      switch (action.type) {
        case 'switch_portal': {
          if (isExamLocked) {
            return 'Tidak dapat berpindah portal saat ujian sedang aktif';
          }
          setActiveRole(action.role);
          return `Pindah ke portal ${action.role.toUpperCase()}`;
        }
        case 'navigate_tab': {
          if (isExamLocked) return 'Navigasi menu ditahan selama ujian berlangsung';
          const normalized = action.tab.toLowerCase().trim() as TeacherTab | AdminTab;
          if (activeRole === 'guru' && TEACHER_TABS.includes(normalized as TeacherTab)) {
            setTeacherTab(normalized as TeacherTab);
            return `Membuka menu ${normalized}`;
          }
          if (activeRole === 'admin' && ADMIN_TABS.includes(normalized as AdminTab)) {
            setAdminTab(normalized as AdminTab);
            return `Membuka menu ${normalized}`;
          }
          if (TEACHER_TABS.includes(normalized as TeacherTab)) {
            setActiveRole('guru');
            setTeacherTab(normalized as TeacherTab);
            return `Pindah ke Portal Guru · ${normalized}`;
          }
          if (ADMIN_TABS.includes(normalized as AdminTab)) {
            setActiveRole('admin');
            setAdminTab(normalized as AdminTab);
            return `Pindah ke Portal Admin · ${normalized}`;
          }
          return undefined;
        }
        case 'open_qr_install': {
          setQrModalOpen(true);
          return 'Membuka Kode QR Install HP';
        }
        case 'open_create_question': {
          if (isExamLocked) return undefined;
          if (activeRole === 'admin') {
            setAdminTab('bank-jadwal');
            return 'Membuka panel Bank Soal Pusat';
          }
          setActiveRole('guru');
          setTeacherTab('bank-soal');
          setExternalCreateQuestionSignal((c) => c + 1);
          return 'Membuka form Tambah Soal Baru';
        }
        case 'export_exam_results': {
          const teacherSubjects = loggedTeacher ? getTeacherSubjects(loggedTeacher) : [];
          const targetResults = action.mataPelajaran
            ? store.results.filter((r) =>
                r.mataPelajaran.toLowerCase().includes(action.mataPelajaran!.toLowerCase())
              )
            : loggedTeacher && activeRole === 'guru'
              ? store.results.filter((r) => teacherSubjects.includes(r.mataPelajaran))
              : store.results;

          if (targetResults.length === 0) {
            return 'Belum ada data nilai untuk diekspor';
          }
          await exportExamResultsToExcel(targetResults);
          emitPetActivity('excel_exported', `Berhasil ekspor ${targetResults.length} data ke Excel!`);
          return `Mengekspor ${targetResults.length} data nilai ke Excel`;
        }
        case 'export_google_sheets': {
          const teacherSubjects = loggedTeacher ? getTeacherSubjects(loggedTeacher) : [];
          const targetResults = action.mataPelajaran
            ? store.results.filter((r) =>
                r.mataPelajaran.toLowerCase().includes(action.mataPelajaran!.toLowerCase())
              )
            : loggedTeacher && activeRole === 'guru'
              ? store.results.filter((r) => teacherSubjects.includes(r.mataPelajaran))
              : store.results;

          openGoogleSheetsModal(
            targetResults,
            action.mataPelajaran
              ? `Rekap Nilai ${action.mataPelajaran} CBT MTs Nurul Hijrah`
              : loggedTeacher && activeRole === 'guru'
                ? `Rekap Nilai ${loggedTeacher.mataPelajaran} CBT MTs Nurul Hijrah`
                : 'Rekap Nilai CBT MTs Nurul Hijrah'
          );
          return `Membuka Google Sheets (${targetResults.length} data nilai)`;
        }
        case 'create_subject': {
          if (!loggedAdmin) {
            setActiveRole('admin');
            return 'Perlu login Super Admin untuk menambah mapel';
          }
          await store.addSubject(action.nama, action.kode);
          return `Mata pelajaran "${action.nama}" ditambahkan`;
        }
        case 'create_class': {
          if (!loggedAdmin) {
            setActiveRole('admin');
            return 'Perlu login Super Admin untuk menambah kelas';
          }
          await store.addClass(action.nama, action.tingkat);
          return `Kelas "${action.nama}" ditambahkan`;
        }
        case 'toggle_exam_schedule': {
          if (!loggedAdmin && !loggedTeacher) {
            return 'Login sebagai Guru atau Admin untuk mengubah status jadwal';
          }
          const q = action.query.toLowerCase();
          const matched = store.exams.find(
            (e) =>
              e.mataPelajaran.toLowerCase().includes(q) ||
              e.judulUjian.toLowerCase().includes(q) ||
              e.token.toLowerCase() === q
          );
          if (!matched) {
            return `Jadwal "${action.query}" tidak ditemukan`;
          }
          if (action.aktif === undefined || matched.aktif !== action.aktif) {
            await store.toggleExamActive(matched.id);
          }
          return `Jadwal ${matched.mataPelajaran} (${matched.token}) diperbarui`;
        }
        case 'prefill_student_entry': {
          if (isExamLocked) return undefined;
          setActiveRole('siswa');
          setStudentPrefill({
            id: Date.now(),
            namaSiswa: action.namaSiswa,
            kelas: action.kelas,
            mataPelajaran: action.mataPelajaran,
            token: action.token,
          });
          return 'Formulir masuk ujian siswa diisikan';
        }
        case 'save_generated_questions': {
          if (!loggedAdmin && !loggedTeacher) {
            return `${action.questions.length} soal dibuat (login Guru/Admin untuk menyimpan ke bank soal)`;
          }
          const resolvedSubject =
            loggedTeacher && activeRole === 'guru'
              ? loggedTeacher.mataPelajaran
              : store.subjects.find(
                  (s) => s.nama.toLowerCase() === action.mataPelajaran.toLowerCase()
                )?.nama ||
                action.mataPelajaran ||
                store.subjects[0]?.nama ||
                'Umum';
          await store.addQuestionsBatch(
            action.questions.map((q) => ({
              mataPelajaran: resolvedSubject,
              tipe: q.tipe,
              pertanyaanHtml: q.pertanyaanHtml,
              opsi: q.opsi,
              kunciJawaban: q.kunciJawaban,
              bobot: q.bobot,
              createdBy: loggedAdmin?.nama || loggedTeacher?.nama || 'Asisten Hewan AI',
            }))
          );
          if (activeRole === 'guru') setTeacherTab('bank-soal');
          if (activeRole === 'admin') setAdminTab('bank-jadwal');
          emitPetActivity(
            'questions_saved',
            `Mantap! ${action.questions.length} soal ${resolvedSubject} tersimpan!`
          );
          return `${action.questions.length} soal ${resolvedSubject} disimpan ke Bank Soal`;
        }
        default:
          return undefined;
      }
    },
    [activeRole, emitPetActivity, isExamLocked, loggedAdmin, loggedTeacher, openGoogleSheetsModal, store]
  );

  return (
    <div className="ios-mesh-bg min-h-[100dvh] w-full max-w-full text-slate-900 flex flex-col relative overflow-x-clip">
      {/* Compositor-only fixed pastel mesh backdrop (zero blur-3xl GPU passes & zero scroll repaint) */}
      <div
        aria-hidden="true"
        className="ios-mesh-backdrop pointer-events-none fixed inset-0 z-0 no-print"
      />

      {/* Auto-update notification banner (defers reload while student is actively taking exam) */}
      {updateAvailable && (
        <div className="relative z-40 bg-emerald-900/90 backdrop-blur-md border-b border-white/20 px-4 py-2 text-center text-xs font-semibold text-white flex flex-wrap items-center justify-center gap-2 no-print">
          <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
          <span>
            {isReloading
              ? 'Memperbarui aplikasi ke versi terbaru...'
              : 'Pembaruan aplikasi tersedia — akan diterapkan otomatis setelah ujian Anda selesai.'}
          </span>
          <button
            type="button"
            onClick={() => setDiagModalOpen(true)}
            className="btn-press rounded-lg border border-white/30 bg-white/15 px-2.5 py-0.5 text-[11px] font-bold text-white hover:bg-white/25 whitespace-nowrap"
          >
            Diagnostik Versi
          </button>
        </div>
      )}

      {/* Offline indicator */}
      {!store.cloudConnected && (
        <div className="relative z-40 bg-amber-600/90 backdrop-blur-md border-b border-white/25 px-4 py-1.5 text-center text-xs font-medium text-white flex items-center justify-center gap-2 no-print">
          <WifiOff className="h-3.5 w-3.5" />
          <span>Mode Offline — Data tersimpan di perangkat dan akan tersinkron saat internet kembali.</span>
        </div>
      )}

      <TopBar
        activeRole={activeRole}
        onSelectRole={(role) => {
          if (!isExamLocked) setActiveRole(role);
        }}
        onOpenQRInstall={() => setQrModalOpen(true)}
        canDirectInstall={pwaInstall.isInstallable && !pwaInstall.isInstalled}
        onDirectInstall={() => {
          void pwaInstall.install();
        }}
        isExamLocked={isExamLocked}
        syncInfo={loggedTeacher || loggedAdmin ? store.syncInfo : undefined}
        onForceSync={store.forceSyncNow}
      />

      <div className="relative z-10 flex-1">
        {activeRole === 'siswa' && (
          <div key="siswa" className="portal-transition-enter" data-portal-view="siswa">
            <StudentPortal
              classes={store.classes}
              exams={store.exams}
              cloudConnected={store.cloudConnected}
              onExamActiveChange={(locked) => {
                setIsExamLocked(locked);
                if (locked) emitPetActivity('exam_started');
              }}
              onSubmitExamResult={async (payload) => {
                await store.submitExamResult(payload);
                if (payload.status === 'Selesai') {
                  emitPetActivity(
                    'exam_submitted_normal',
                    `Yeay! ${payload.namaSiswa} menyelesaikan ujian ${payload.mataPelajaran} — Bangga banget!`
                  );
                } else {
                  emitPetActivity(
                    'exam_submitted_violation',
                    `Ujian ${payload.namaSiswa} terkumpul otomatis karena pelanggaran.`
                  );
                }
              }}
              onUpsertLiveStream={store.upsertLiveStream}
              onDeleteLiveStream={store.deleteLiveStream}
              onOpenQRInstall={() => setQrModalOpen(true)}
              externalPrefill={studentPrefill}
            />
          </div>
        )}

        {activeRole === 'guru' && (
          <Suspense fallback={<PortalLoader />}>
            <div key="guru" className="portal-transition-enter" data-portal-view="guru">
              <TeacherPortal
                loggedTeacher={loggedTeacher}
                onSetLoggedTeacher={setLoggedTeacher}
                subjects={store.subjects}
                classes={store.classes}
                questions={store.questions}
                exams={store.exams}
                results={store.results}
                liveStreams={store.liveStreams}
                onAuthenticate={store.authenticateTeacher}
                onAddQuestion={store.addQuestion}
                onAddQuestionsBatch={store.addQuestionsBatch}
                onUpdateQuestion={store.updateQuestion}
                onDeleteQuestion={store.deleteQuestion}
                onDeleteQuestionsBatch={store.deleteQuestionsBatch}
                onClearBankBySubject={store.clearBankBySubject}
                onSaveExam={store.saveExamSchedule}
                onToggleExamActive={store.toggleExamActive}
                onDeleteExam={store.deleteExamSchedule}
                onSendProctorWarning={store.sendProctorWarning}
                onUpdateEssayScore={store.updateResultEssayScore}
                activeTab={teacherTab}
                onActiveTabChange={setTeacherTab}
                externalCreateQuestionSignal={externalCreateQuestionSignal}
                onOpenGoogleSheets={openGoogleSheetsModal}
                syncInfo={store.syncInfo}
                onForceSync={store.forceSyncNow}
              />
            </div>
          </Suspense>
        )}

        {activeRole === 'admin' && (
          <Suspense fallback={<PortalLoader />}>
            <div key="admin" className="portal-transition-enter" data-portal-view="admin">
              <AdminPortal
                loggedAdmin={loggedAdmin}
                onSetLoggedAdmin={setLoggedAdmin}
                subjects={store.subjects}
                classes={store.classes}
                teachers={store.teachers}
                questions={store.questions}
                exams={store.exams}
                results={store.results}
                liveStreams={store.liveStreams}
                onAuthenticate={store.authenticateAdmin}
                onAddSubject={store.addSubject}
                onUpdateSubject={store.updateSubject}
                onDeleteSubject={store.deleteSubject}
                onAddClass={store.addClass}
                onUpdateClass={store.updateClass}
                onDeleteClass={store.deleteClass}
                onAddTeacher={store.addTeacher}
                onUpdateTeacher={store.updateTeacher}
                onDeleteTeacher={store.deleteTeacher}
                onAddQuestion={store.addQuestion}
                onAddQuestionsBatch={store.addQuestionsBatch}
                onUpdateQuestion={store.updateQuestion}
                onDeleteQuestion={store.deleteQuestion}
                onDeleteQuestionsBatch={store.deleteQuestionsBatch}
                onClearBankBySubject={store.clearBankBySubject}
                onSaveExam={store.saveExamSchedule}
                onToggleExamActive={store.toggleExamActive}
                onDeleteExam={store.deleteExamSchedule}
                onSendProctorWarning={store.sendProctorWarning}
                onUpdateEssayScore={store.updateResultEssayScore}
                onDeleteResult={store.deleteExamResult}
                activeTab={adminTab}
                onActiveTabChange={setAdminTab}
                onOpenGoogleSheets={openGoogleSheetsModal}
                syncInfo={store.syncInfo}
                syncLogs={store.syncLogs}
                onForceSync={store.forceSyncNow}
                onOpenDiagnostics={() => setDiagModalOpen(true)}
              />
            </div>
          </Suspense>
        )}
      </div>

      <footer className="relative z-10 border-t border-white/45 bg-white/30 backdrop-blur-md px-4 sm:px-6 pt-4 pb-24 sm:pb-20 lg:pb-5 text-center text-xs font-medium text-slate-600 no-print">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <span>CBT MTs Nurul Hijrah &middot; Sistem Evaluasi Digital Terpadu</span>
          <span className="text-slate-400">&middot;</span>
          <span className="font-mono-tabular font-semibold text-slate-700">
            v{currentVersion} &middot; #{currentBuildHash.slice(0, 8)}
          </span>
          {!isExamLocked && (
            <button
              type="button"
              onClick={async () => {
                setUpdateCheckStatus(null);
                const status = await checkAndApplyUpdateNow(false);
                if (status === 'up-to-date') {
                  setUpdateCheckStatus('Sudah versi terbaru');
                  if (statusClearTimerRef.current !== null) {
                    window.clearTimeout(statusClearTimerRef.current);
                  }
                  statusClearTimerRef.current = window.setTimeout(() => {
                    statusClearTimerRef.current = null;
                    setUpdateCheckStatus(null);
                  }, 3500);
                }
              }}
              disabled={isCheckingUpdate}
              className="btn-press min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-white/90 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw className={`h-3 w-3 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              <span>{updateCheckStatus || 'Cek Pembaruan'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setDiagModalOpen(true)}
            data-testid="open-version-diagnostics-btn"
            className="btn-press min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white/90 whitespace-nowrap"
          >
            <Cpu className="h-3 w-3 text-emerald-700" />
            <span>Diagnostik Hash</span>
          </button>
        </div>
      </footer>

      <VirtualPetAssistant
        appContext={petAppContext}
        activitySignal={petActivitySignal}
        onExecuteAction={executePetAction}
      />

      {qrModalOpen && (
        <Suspense fallback={null}>
          <QRInstallModal
            open={qrModalOpen}
            onClose={() => setQrModalOpen(false)}
            onForceUpdateApp={() => checkAndApplyUpdateNow(true)}
            onOpenDiagnostics={() => setDiagModalOpen(true)}
            isCheckingUpdate={isCheckingUpdate}
          />
        </Suspense>
      )}

      {diagModalOpen && (
        <Suspense fallback={null}>
          <VersionDiagnosticModal
            open={diagModalOpen}
            onClose={() => setDiagModalOpen(false)}
            diagnostics={diagnostics}
            deviceId={store.deviceId}
            isExamLocked={isExamLocked}
            isChecking={isCheckingUpdate}
            onRefreshDiagnostics={refreshDiagnostics}
            onForceHardReset={forceHardResetAndReload}
          />
        </Suspense>
      )}

      {googleSheetsState.open && (
        <Suspense fallback={null}>
          <GoogleSheetsExportModal
            open={googleSheetsState.open}
            results={googleSheetsState.results}
            defaultTitle={googleSheetsState.defaultTitle}
            onClose={() => setGoogleSheetsState((s) => ({ ...s, open: false }))}
            onExportSuccess={(exported) => {
              emitPetActivity(
                'sheets_exported',
                `Mantap! ${exported.rowCount} nilai sukses dikirim ke "${exported.title}"!`
              );
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
