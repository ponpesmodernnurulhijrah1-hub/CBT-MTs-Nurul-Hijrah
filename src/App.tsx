import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import type { AdminAccount, ExamResult, TeacherAccount, UserRole } from './types/cbt';
import { useCbtStore } from './hooks/useCbtStore';
import { useAppUpdater } from './hooks/useAppUpdater';
import { TopBar } from './components/TopBar';
import { StudentPortal } from './components/StudentPortal';
import { VirtualPetAssistant, type PetActivitySignal } from './components/VirtualPetAssistant';
import { exportExamResultsToExcel } from './utils/exportHelpers';
import { getTeacherSubjects } from './utils/storeSyncUtils';
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
    checkAndApplyUpdateNow,
  } = useAppUpdater(isExamLocked, store.pulseAppVersion);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<string | null>(null);

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
    <div className="ios-mesh-bg min-h-screen text-slate-900 flex flex-col relative overflow-x-clip">
      {/* Subtle ambient depth orbs behind glass layers (non-interactive, compositor-safe) */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 overflow-hidden no-print"
      >
        <div className="absolute -top-28 -left-24 h-96 w-96 rounded-full bg-emerald-200/45 blur-3xl" />
        <div className="absolute top-12 -right-24 h-[28rem] w-[28rem] rounded-full bg-sky-200/50 blur-3xl" />
        <div className="absolute bottom-[-6rem] left-1/3 h-96 w-96 rounded-full bg-indigo-200/40 blur-3xl" />
      </div>

      {/* Auto-update notification banner (defers reload while student is actively taking exam) */}
      {updateAvailable && (
        <div className="relative z-40 bg-emerald-900/90 backdrop-blur-md border-b border-white/20 px-4 py-2 text-center text-xs font-semibold text-white flex items-center justify-center gap-2 no-print">
          <RefreshCw className={`h-3.5 w-3.5 ${isReloading ? 'animate-spin' : ''}`} />
          <span>
            {isReloading
              ? 'Memperbarui aplikasi ke versi terbaru...'
              : 'Pembaruan aplikasi tersedia — akan diterapkan otomatis setelah ujian Anda selesai.'}
          </span>
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
        isExamLocked={isExamLocked}
        syncInfo={loggedTeacher || loggedAdmin ? store.syncInfo : undefined}
        onForceSync={store.forceSyncNow}
      />

      <div className="relative z-10 flex-1">
        {activeRole === 'siswa' && (
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
        )}

        {activeRole === 'guru' && (
          <Suspense fallback={<PortalLoader />}>
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
          </Suspense>
        )}

        {activeRole === 'admin' && (
          <Suspense fallback={<PortalLoader />}>
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
            />
          </Suspense>
        )}
      </div>

      <footer className="relative z-10 border-t border-white/45 bg-white/30 backdrop-blur-md px-6 py-4 text-center text-xs font-medium text-slate-600 no-print">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1.5">
          <span>CBT MTs Nurul Hijrah &middot; Sistem Evaluasi Digital Terpadu</span>
          <span className="text-slate-400">&middot;</span>
          <span className="font-mono-tabular font-semibold text-slate-700">
            v{currentVersion}
          </span>
          {!isExamLocked && (
            <button
              type="button"
              onClick={async () => {
                setUpdateCheckStatus(null);
                const status = await checkAndApplyUpdateNow(false);
                if (status === 'up-to-date') {
                  setUpdateCheckStatus('Sudah versi terbaru');
                  window.setTimeout(() => setUpdateCheckStatus(null), 3500);
                }
              }}
              disabled={isCheckingUpdate}
              className="btn-press inline-flex items-center gap-1 rounded-lg border border-white/65 bg-white/55 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-white/85 disabled:opacity-60"
            >
              <RefreshCw className={`h-3 w-3 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
              <span>{updateCheckStatus || 'Cek Pembaruan'}</span>
            </button>
          )}
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
            isCheckingUpdate={isCheckingUpdate}
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
