import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Mic,
  ShieldAlert,
  Clock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Send,
  LogOut,
  QrCode,
  Volume2,
  AlertTriangle,
  Lock,
  BookOpen,
  Check,
  Radio,
  Search,
  Video,
  VideoOff,
  X,
  Printer,
} from 'lucide-react';
import { printStudentExamReceipt } from '../utils/exportHelpers';
import type {
  ClassItem,
  ExamResult,
  ExamSchedule,
  ExamSubmissionStatus,
  LiveStreamSession,
  Question,
  ViolationLogEntry,
} from '../types/cbt';
import {
  APP_EXIT_GRACE_SECONDS,
  MAX_APP_EXIT_CHANCES,
  buildExamResultPayload,
  computeExitGraceSecondsLeft,
  evaluateAppExitStrike,
  getOptionLetter,
  shouldDebounceAppExit,
} from '../utils/examLogic';
import {
  getLoudAlarmAudioSrc,
  playLoudSiren,
  playWarningBeep,
  registerAlarmAudioElement,
  stopLoudSiren,
  unlockAlarmAudio,
} from '../utils/alarmAudio';
import {
  archiveStudentViolationsForResult,
  clearStudentSessionViolations,
  loadStudentSessionViolations,
  markLastViolationReturned,
  recordStudentViolation,
} from '../utils/violationTracker';
import { useStudentWebRTCPublisher } from '../hooks/useWebRTCProctor';
import { useLiquidMorphPill, useQuestionSlideDirection } from '../hooks/useLiquidMotion';

interface StudentPortalProps {
  classes: ClassItem[];
  exams: ExamSchedule[];
  cloudConnected: boolean;
  onExamActiveChange: (active: boolean) => void;
  onSubmitExamResult: (result: ExamResult) => Promise<void>;
  onUpsertLiveStream: (session: LiveStreamSession) => Promise<void>;
  onDeleteLiveStream: (sessionId: string) => Promise<void>;
  onOpenQRInstall: () => void;
  externalPrefill?: {
    id: number;
    namaSiswa?: string;
    kelas?: string;
    mataPelajaran?: string;
    token?: string;
  } | null;
}

type StudentViewStage = 'lobby' | 'exam' | 'submitted';

export const StudentPortal: React.FC<StudentPortalProps> = ({
  classes,
  exams,
  cloudConnected,
  onExamActiveChange,
  onSubmitExamResult,
  onUpsertLiveStream,
  onDeleteLiveStream,
  onOpenQRInstall,
  externalPrefill,
}) => {
  const [stage, setStage] = useState<StudentViewStage>('lobby');

  // Lobby form state
  const [namaSiswa, setNamaSiswa] = useState('');
  const [noPeserta, setNoPeserta] = useState('');
  const [kelas, setKelas] = useState(classes[0]?.nama || '');
  const [selectedExamId, setSelectedExamId] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [startingExam, setStartingExam] = useState(false);

  // Active exam state
  const [activeExam, setActiveExam] = useState<ExamSchedule | null>(null);
  const [examQuestions, setExamQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answersMap, setAnswersMap] = useState<Record<string, string[]>>({});
  const [doubtfulMap, setDoubtfulMap] = useState<Record<string, boolean>>({});
  const [navFilter, setNavFilter] = useState<'ALL' | 'UNANSWERED' | 'DOUBTFUL'>('ALL');
  const [fontScale, setFontScale] = useState<'normal' | 'large' | 'xlarge'>('normal');
  const [scheduleSearch, setScheduleSearch] = useState('');
  const [previewActive, setPreviewActive] = useState(false);
  const [previewAudioLevel, setPreviewAudioLevel] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewChecking, setPreviewChecking] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState<ExamResult | null>(null);
  const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);

  // Proctoring & Hardware state
  const [sessionId, setSessionId] = useState('');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaLockedReason, setMediaLockedReason] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [tabViolations, setTabViolations] = useState(0);
  const [faceWarnings, setFaceWarnings] = useState(0);
  const [faceStatus, setFaceStatus] = useState('Wajah Terdeteksi');
  const [exitGraceSecondsLeft, setExitGraceSecondsLeft] = useState<number | null>(null);
  const [exitGraceReturned, setExitGraceReturned] = useState(false);
  const [lastExitSource, setLastExitSource] = useState('');
  const [securityBanner, setSecurityBanner] = useState<string | null>(null);
  const [timerToast, setTimerToast] = useState<string | null>(null);
  const [persistentAlarmOnSummary, setPersistentAlarmOnSummary] = useState(false);

  const alarmAudioSrc = useMemo(() => getLoudAlarmAudioSrc(), []);
  const alarmAudioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const snapshotCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const submittedRef = useRef(false);
  const tabViolationsRef = useRef(0);
  const faceWarningsRef = useRef(0);
  const faceStatusRef = useRef('Wajah Terdeteksi');
  const audioLevelRef = useRef(0);
  const warned15Ref = useRef(false);
  const warned5Ref = useRef(false);
  const exitStartedAtRef = useRef<number | null>(null);
  const examDeadlineMsRef = useRef<number>(0);
  const lastExitViolationTsRef = useRef(0);
  const wasFullscreenRef = useRef(false);
  const violationHistoryRef = useRef<ViolationLogEntry[]>([]);
  const timerToastTimerRef = useRef<number | null>(null);
  const filterNavRef = useRef<HTMLDivElement | null>(null);
  const questionGridRef = useRef<HTMLDivElement | null>(null);
  const questionSlideDirection = useQuestionSlideDirection(currentIdx);
  const questionSlideClass =
    questionSlideDirection === 'forward'
      ? 'question-slide-next'
      : questionSlideDirection === 'backward'
        ? 'question-slide-prev'
        : 'panel-enter';
  const filterMorph = useLiquidMorphPill(
    filterNavRef,
    stage === 'exam' ? navFilter : null,
    `${examQuestions.length}-${navFilter}`
  );
  const isCurrentInFilteredGrid =
    stage === 'exam' &&
    examQuestions[currentIdx] !== undefined &&
    (() => {
      const cq = examQuestions[currentIdx];
      if (!cq) return false;
      const isAns = (answersMap[cq.id]?.length || 0) > 0;
      const isDoubt = Boolean(doubtfulMap[cq.id]);
      if (navFilter === 'UNANSWERED') return !isAns;
      if (navFilter === 'DOUBTFUL') return isDoubt;
      return true;
    })();
  const questionGridMorph = useLiquidMorphPill(
    questionGridRef,
    isCurrentInFilteredGrid ? currentIdx : null,
    `${examQuestions.length}-${navFilter}`
  );

  useEffect(() => {
    registerAlarmAudioElement(alarmAudioRef.current);
    return () => {
      stopLoudSiren();
      registerAlarmAudioElement(null);
    };
  }, []);

  // Sync default class & exam options dynamically when Admin/Teacher updates
  useEffect(() => {
    if (classes.length > 0 && (!kelas || !classes.some((c) => c.nama === kelas))) {
      setKelas(classes[0].nama);
    }
  }, [classes, kelas]);

  useEffect(() => {
    if (!externalPrefill || stage !== 'lobby') return;
    if (externalPrefill.namaSiswa) setNamaSiswa(externalPrefill.namaSiswa);
    if (externalPrefill.kelas) {
      const matchedCls = classes.find(
        (c) => c.nama.toLowerCase() === externalPrefill.kelas!.toLowerCase()
      );
      if (matchedCls) setKelas(matchedCls.nama);
    }
    if (externalPrefill.mataPelajaran) {
      const q = externalPrefill.mataPelajaran.toLowerCase();
      const matchedExam = exams.find(
        (e) => e.aktif && e.mataPelajaran.toLowerCase().includes(q)
      );
      if (matchedExam) setSelectedExamId(matchedExam.id);
    }
    if (externalPrefill.token) setTokenInput(externalPrefill.token.toUpperCase());
  }, [externalPrefill, stage, classes, exams]);

  const availableExams = useMemo(() => {
    return exams.filter((e) => {
      if (!e.aktif) return false;
      if (!kelas) return true;
      return e.kelasTarget.includes('Semua Kelas') || e.kelasTarget.includes(kelas);
    });
  }, [exams, kelas]);

  useEffect(() => {
    if (
      availableExams.length > 0 &&
      !availableExams.some((e) => e.id === selectedExamId)
    ) {
      setSelectedExamId(availableExams[0].id);
    }
  }, [availableExams, selectedExamId]);

  const stopPreviewHardware = useCallback(() => {
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach((t) => t.stop());
      previewStreamRef.current = null;
    }
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
    setPreviewActive(false);
    setPreviewAudioLevel(0);
  }, []);

  useEffect(() => {
    return () => {
      stopPreviewHardware();
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      if (timerToastTimerRef.current !== null) {
        window.clearTimeout(timerToastTimerRef.current);
        timerToastTimerRef.current = null;
      }
    };
  }, [stopPreviewHardware]);

  useEffect(() => {
    if (!previewActive || !previewStreamRef.current) return;
    const stream = previewStreamRef.current;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = stream;
    }
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArr: Uint8Array<ArrayBuffer> | null = null;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
        const src = audioCtx.createMediaStreamSource(stream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 128;
        src.connect(analyser);
        dataArr = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
    } catch {
      // Ignore audio preview meter errors
    }
    const meterId = window.setInterval(() => {
      if (analyser && dataArr) {
        analyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        setPreviewAudioLevel(Math.min(100, Math.round((sum / dataArr.length / 128) * 100)));
      }
    }, 180);
    return () => {
      window.clearInterval(meterId);
      audioCtx?.close().catch(() => {});
    };
  }, [previewActive]);

  const handleToggleHardwarePreview = async () => {
    if (previewActive) {
      stopPreviewHardware();
      setPreviewError(null);
      return;
    }
    setPreviewError(null);
    setPreviewChecking(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Peramban tidak mendukung akses kamera/mikrofon.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: true,
      });
      previewStreamRef.current = stream;
      setPreviewActive(true);
    } catch {
      setPreviewError(
        'Kamera atau mikrofon belum terdeteksi / izin ditolak. Pastikan perangkat memiliki kamera & mikrofon aktif sebelum memulai ujian.'
      );
    } finally {
      setPreviewChecking(false);
    }
  };

  const stopHardwareAndFullscreen = useCallback(
    async (sid: string, keepAlarmActive = false) => {
      if (!keepAlarmActive) {
        stopLoudSiren();
      }
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setLocalStream(null);
      if (sid) {
        await onDeleteLiveStream(sid).catch(() => {});
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    },
    [onDeleteLiveStream]
  );

  // UNIFIED SUBMIT HANDLER (100% identical path for Normal & Pelanggaran, awaits DB before exit)
  const handleUnifiedSubmit = useCallback(
    async (status: ExamSubmissionStatus, reason?: string) => {
      if (submittedRef.current || !activeExam) return;
      submittedRef.current = true;
      setIsSubmitting(true);
      setShowConfirmSubmit(false);

      exitStartedAtRef.current = null;
      setExitGraceSecondsLeft(null);
      setExitGraceReturned(false);

      const isViolation = status === 'Pelanggaran';
      if (isViolation) {
        // Keep persistent loud alarm looping continuously across submit screen until manually turned off
        playLoudSiren(0);
        setPersistentAlarmOnSummary(true);
      } else {
        setPersistentAlarmOnSummary(false);
      }

      const examWithOrderedQuestions: ExamSchedule = {
        ...activeExam,
        questionsSnapshot: examQuestions,
      };

      const persistedSessionViolations = loadStudentSessionViolations(
        activeExam.id,
        namaSiswa,
        kelas
      );
      const finalViolationHistory =
        persistedSessionViolations.length > 0
          ? persistedSessionViolations
          : violationHistoryRef.current;

      const payload = buildExamResultPayload({
        exam: examWithOrderedQuestions,
        namaSiswa,
        noPeserta: noPeserta.trim() || undefined,
        kelas,
        answersMap,
        doubtfulMap,
        status,
        pelanggaranTab: tabViolationsRef.current,
        peringatanWajah: faceWarningsRef.current,
        alasanSubmit: reason,
        violationHistory: finalViolationHistory,
      });

      // CRITICAL: await database save 100% BEFORE stopping camera/mic or leaving screen!
      await onSubmitExamResult(payload);
      archiveStudentViolationsForResult({
        resultId: payload.id,
        examId: activeExam.id,
        namaSiswa,
        kelas,
        entries: finalViolationHistory,
      });
      await stopHardwareAndFullscreen(sessionId, isViolation);

      setSubmittedSummary(payload);
      setStage('submitted');
      onExamActiveChange(false);
      setIsSubmitting(false);
    },
    [
      activeExam,
      examQuestions,
      namaSiswa,
      noPeserta,
      kelas,
      answersMap,
      doubtfulMap,
      sessionId,
      onSubmitExamResult,
      stopHardwareAndFullscreen,
      onExamActiveChange,
    ]
  );

  const handleUnifiedSubmitRef = useRef(handleUnifiedSubmit);
  handleUnifiedSubmitRef.current = handleUnifiedSubmit;

  // React instantly if Guru / Admin stops/deactivates this exam remotely via real-time sync
  useEffect(() => {
    if (stage !== 'exam' || !activeExam || submittedRef.current) return;
    const liveSchedule = exams.find((ex) => ex.id === activeExam.id);
    if (!liveSchedule || !liveSchedule.aktif) {
      setSecurityBanner('Ujian telah dihentikan oleh Guru/Admin Pengawas. Jawaban otomatis dikirim.');
      void handleUnifiedSubmitRef.current('Selesai', 'Dihentikan oleh Guru/Admin Pengawas');
    }
  }, [stage, activeExam, exams]);

  // WebRTC Publisher hook
  useStudentWebRTCPublisher({
    enabled: stage === 'exam' && Boolean(sessionId) && Boolean(localStream),
    sessionId,
    localStream,
    onRemoteWarning: useCallback((msg: string) => {
      setSecurityBanner(msg);
      // Do not replace an ongoing continuous app-exit alarm with a 3.2s timed siren
      if (exitStartedAtRef.current === null && !submittedRef.current) {
        playLoudSiren(3200);
      }
    }, []),
  });

  // Attach localStream to student preview video
  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream, stage]);

  // Wall-clock Countdown Timer & 15-min / 5-min toast alerts (immune to tab throttling)
  useEffect(() => {
    if (stage !== 'exam' || examDeadlineMsRef.current <= 0) return;

    const syncRemainingTime = () => {
      const next = Math.max(0, Math.ceil((examDeadlineMsRef.current - Date.now()) / 1000));
      setRemainingSeconds(next);

      if (next > 0 && next <= 900 && next > 300 && !warned15Ref.current) {
        warned15Ref.current = true;
        playWarningBeep();
        setTimerToast('Perhatian: Waktu ujian tersisa 15 menit lagi!');
        if (timerToastTimerRef.current !== null) window.clearTimeout(timerToastTimerRef.current);
        timerToastTimerRef.current = window.setTimeout(() => {
          timerToastTimerRef.current = null;
          setTimerToast(null);
        }, 6000);
      }
      if (next > 0 && next <= 300 && !warned5Ref.current) {
        warned5Ref.current = true;
        playWarningBeep();
        setTimerToast('Peringatan Penting: Waktu ujian tinggal 5 menit lagi!');
        if (timerToastTimerRef.current !== null) window.clearTimeout(timerToastTimerRef.current);
        timerToastTimerRef.current = window.setTimeout(() => {
          timerToastTimerRef.current = null;
          setTimerToast(null);
        }, 7000);
      }
      if (next <= 0) {
        handleUnifiedSubmitRef.current('Selesai', 'Waktu ujian habis (Auto-Submit)');
      }
    };

    syncRemainingTime();
    const timerId = window.setInterval(syncRemainingTime, 1000);

    return () => {
      window.clearInterval(timerId);
      if (timerToastTimerRef.current !== null) {
        window.clearTimeout(timerToastTimerRef.current);
        timerToastTimerRef.current = null;
      }
    };
  }, [stage]);

  // Ultra-High Security: App Exit / Switch App / Copy-Paste / Right-Click Protection
  // Max 3x chances (1/3, 2/3, 3/3). Exiting/switching apps triggers very loud noisy alarm + 30s return timer.
  // >3x OR staying outside >30 seconds triggers immediate auto-submit as Pelanggaran!
  useEffect(() => {
    if (stage !== 'exam') return;

    const registerAppExitViolation = (sourceLabel: string) => {
      if (submittedRef.current) return;
      const now = Date.now();

      // Prevent double-counting when browser fires blur + visibilitychange for one exit,
      // or if student is still outside with the 30s countdown already running.
      if (
        shouldDebounceAppExit(lastExitViolationTsRef.current, now) ||
        exitStartedAtRef.current !== null
      ) {
        return;
      }
      lastExitViolationTsRef.current = now;

      const evalResult = evaluateAppExitStrike(tabViolationsRef.current, sourceLabel);
      tabViolationsRef.current = evalResult.nextCount;
      setTabViolations(evalResult.nextCount);
      setLastExitSource(sourceLabel);

      if (activeExam) {
        violationHistoryRef.current = recordStudentViolation({
          examId: activeExam.id,
          namaSiswa,
          kelas,
          strikeNumber: evalResult.nextCount,
          reason: sourceLabel,
        });
      }

      if (evalResult.exceededLimit) {
        exitStartedAtRef.current = null;
        setExitGraceSecondsLeft(null);
        setExitGraceReturned(false);
        playLoudSiren(0);
        setSecurityBanner(
          `PELANGGARAN BERAT (${evalResult.nextCount}x keluar / membuka aplikasi lain)! Jawaban langsung dikirim.`
        );
        handleUnifiedSubmitRef.current('Pelanggaran', evalResult.autoSubmitReason);
        return;
      }

      // Strikes 1..3: Sound continuous very loud noisy alarm + start 30-second return grace timer!
      playLoudSiren(0);
      exitStartedAtRef.current = now;
      setExitGraceReturned(false);
      setExitGraceSecondsLeft(APP_EXIT_GRACE_SECONDS);
      setSecurityBanner(
        `ALARM PELANGGARAN (${evalResult.nextCount}/${MAX_APP_EXIT_CHANCES}): Terdeteksi ${sourceLabel}! Segera kembali dalam ${APP_EXIT_GRACE_SECONDS} detik atau jawaban otomatis dikirim.`
      );
    };

    const handleReturnToApp = () => {
      if (submittedRef.current) return;
      if (
        exitStartedAtRef.current !== null &&
        document.visibilityState === 'visible' &&
        document.hasFocus()
      ) {
        // Student returned within the 30-second window: pause auto-submit countdown and log return time
        exitStartedAtRef.current = null;
        setExitGraceReturned(true);
        if (activeExam) {
          violationHistoryRef.current = markLastViolationReturned({
            examId: activeExam.id,
            namaSiswa,
            kelas,
          });
        }
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        registerAppExitViolation('Pindah Tab / Membuka Aplikasi Lain');
      } else {
        handleReturnToApp();
      }
    };
    const onBlur = () => {
      registerAppExitViolation('Membuka Aplikasi Lain / Keluar Layar Ujian');
    };
    const onFocus = () => {
      handleReturnToApp();
    };
    const onPageHide = () => {
      registerAppExitViolation('Keluar dari Aplikasi');
    };
    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        wasFullscreenRef.current = true;
      } else if (wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        registerAppExitViolation('Keluar dari Mode Layar Penuh');
      }
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onCopyPaste = (e: ClipboardEvent) => e.preventDefault();
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        ['c', 'v', 'x', 'u', 'p', 's'].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
      }
      if (e.key === 'F12') e.preventDefault();
    };

    // High-accuracy wall-clock 30s grace timer (immune to background tab interval throttling)
    const graceCheckId = window.setInterval(() => {
      if (submittedRef.current || exitStartedAtRef.current === null) return;
      const left = computeExitGraceSecondsLeft(
        exitStartedAtRef.current,
        Date.now(),
        APP_EXIT_GRACE_SECONDS
      );
      setExitGraceSecondsLeft(left);
      if (left <= 0) {
        exitStartedAtRef.current = null;
        setExitGraceReturned(false);
        playLoudSiren(0);
        if (activeExam) {
          violationHistoryRef.current = recordStudentViolation({
            examId: activeExam.id,
            namaSiswa,
            kelas,
            strikeNumber: tabViolationsRef.current,
            reason: `Timeout ${APP_EXIT_GRACE_SECONDS} detik — tidak kembali ke layar ujian`,
          });
        }
        handleUnifiedSubmitRef.current(
          'Pelanggaran',
          `Tidak kembali ke layar ujian dalam batas waktu ${APP_EXIT_GRACE_SECONDS} detik (Keluar ke-${tabViolationsRef.current}/${MAX_APP_EXIT_CHANCES})`
        );
      }
    }, 250);

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('copy', onCopyPaste);
    document.addEventListener('paste', onCopyPaste);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.clearInterval(graceCheckId);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('copy', onCopyPaste);
      document.removeEventListener('paste', onCopyPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [stage, activeExam, namaSiswa, kelas]);

  // Continuous Camera/Mic Health + Audio Meter + Face/Eye Gaze Detection + Live Stream Sync
  useEffect(() => {
    if (stage !== 'exam' || !localStream || !activeExam || !sessionId) return;

    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArr: Uint8Array<ArrayBuffer> | null = null;

    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        audioCtx = new Ctx();
        const src = audioCtx.createMediaStreamSource(localStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        dataArr = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      }
    } catch {
      // Ignore audio analyser init errors
    }

    // Audio level meter loop (every 200ms)
    const audioMeterId = window.setInterval(() => {
      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];

      if (
        !videoTrack ||
        !audioTrack ||
        videoTrack.readyState !== 'live' ||
        audioTrack.readyState !== 'live' ||
        !videoTrack.enabled ||
        !audioTrack.enabled
      ) {
        setMediaLockedReason(
          'Kamera depan atau mikrofon terputus/dimatikan! Wajib aktifkan kembali untuk melanjutkan ujian.'
        );
      } else {
        setMediaLockedReason(null);
      }

      if (analyser && dataArr) {
        analyser.getByteFrequencyData(dataArr);
        let sum = 0;
        for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
        const avg = Math.min(100, Math.round((sum / dataArr.length / 128) * 100));
        audioLevelRef.current = avg;
        setAudioLevel(avg);
      }
    }, 200);

    // Live Camera Preview Snapshot + Camera/Face Presence Check + Live Stream Sync loop (every 2500ms)
    const proctorLoopId = window.setInterval(async () => {
      if (submittedRef.current) return;
      const videoEl = videoRef.current;
      const canvasEl = snapshotCanvasRef.current;
      let snapshotPreview: string | undefined;
      let currentFaceStatus = 'Wajah Terdeteksi';

      if (videoEl && canvasEl && videoEl.readyState >= 2) {
        try {
          canvasEl.width = 160;
          canvasEl.height = 120;
          const ctx = canvasEl.getContext('2d');
          if (ctx) {
            ctx.drawImage(videoEl, 0, 0, 160, 120);
            snapshotPreview = canvasEl.toDataURL('image/jpeg', 0.45);

            // Lightweight pixel luminance/variance check for covered/blocked camera
            const imgData = ctx.getImageData(20, 15, 120, 90).data;
            let sum = 0;
            let sumSq = 0;
            const pixels = imgData.length / 4;
            for (let i = 0; i < imgData.length; i += 4) {
              const luma = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
              sum += luma;
              sumSq += luma * luma;
            }
            const mean = pixels > 0 ? sum / pixels : 0;
            const stdDev = pixels > 0 ? Math.sqrt(Math.max(0, sumSq / pixels - mean * mean)) : 0;
            if (mean < 12 && stdDev < 6) {
              currentFaceStatus = 'Kamera Tertutup';
              faceWarningsRef.current += 1;
              setFaceWarnings(faceWarningsRef.current);
            } else {
              const Detector = (
                window as unknown as {
                  FaceDetector?: new () => { detect: (img: HTMLCanvasElement) => Promise<unknown[]> };
                }
              ).FaceDetector;
              if (Detector) {
                try {
                  const detector = new Detector();
                  const faces = await detector.detect(canvasEl);
                  if (!faces || faces.length === 0) {
                    currentFaceStatus = 'Wajah Tidak Terlihat';
                    faceWarningsRef.current += 1;
                    setFaceWarnings(faceWarningsRef.current);
                  }
                } catch {
                  // Native FaceDetector unavailable/unsupported on this context
                }
              }
            }
          }
        } catch {
          // Ignore canvas taint
        }
      }

      faceStatusRef.current = currentFaceStatus;
      setFaceStatus(currentFaceStatus);

      onUpsertLiveStream({
        sessionId,
        namaSiswa,
        noPeserta: noPeserta.trim() || undefined,
        kelas,
        mataPelajaran: activeExam.mataPelajaran,
        judulUjian: activeExam.judulUjian,
        examId: activeExam.id,
        status: 'aktif',
        audioLevel: audioLevelRef.current,
        pelanggaranTab: tabViolationsRef.current,
        peringatanWajah: faceWarningsRef.current,
        lastFaceStatus: currentFaceStatus,
        snapshotPreview,
        updatedAt: Date.now(),
      }).catch(() => {});
    }, 2500);

    return () => {
      window.clearInterval(audioMeterId);
      window.clearInterval(proctorLoopId);
      audioCtx?.close().catch(() => {});
    };
  }, [stage, localStream, activeExam, sessionId, namaSiswa, noPeserta, kelas, onUpsertLiveStream]);

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setLobbyError(null);

    if (!namaSiswa.trim()) {
      setLobbyError('Masukkan Nama Lengkap Siswa terlebih dahulu.');
      return;
    }
    if (!kelas) {
      setLobbyError('Pilih Kelas Anda terlebih dahulu.');
      return;
    }
    const targetExam = availableExams.find((ex) => ex.id === selectedExamId);
    if (!targetExam) {
      setLobbyError('Tidak ada jadwal ujian aktif yang dipilih.');
      return;
    }
    if (tokenInput.trim().toUpperCase() !== targetExam.token.toUpperCase()) {
      setLobbyError('Token ujian tidak valid! Periksa kembali token dari guru pengawas.');
      return;
    }
    if (targetExam.questionsSnapshot.length === 0) {
      setLobbyError('Paket soal pada jadwal ujian ini masih kosong.');
      return;
    }

    setStartingExam(true);
    stopPreviewHardware();
    // Unlock audio immediately inside click gesture so emergency alarm works automatically
    await unlockAlarmAudio();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: true,
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      const newSessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setSessionId(newSessionId);

      // Prepare question order
      const qs = [...targetExam.questionsSnapshot];
      if (targetExam.acakSoal) {
        qs.sort(() => Math.random() - 0.5);
      }

      submittedRef.current = false;
      tabViolationsRef.current = 0;
      faceWarningsRef.current = 0;
      faceStatusRef.current = 'Wajah Terdeteksi';
      warned15Ref.current = false;
      warned5Ref.current = false;
      exitStartedAtRef.current = null;
      lastExitViolationTsRef.current = 0;
      wasFullscreenRef.current = false;
      violationHistoryRef.current = [];
      clearStudentSessionViolations(targetExam.id, namaSiswa, kelas);

      setActiveExam(targetExam);
      setExamQuestions(qs);
      setCurrentIdx(0);
      setAnswersMap({});
      setDoubtfulMap({});
      setTabViolations(0);
      setFaceWarnings(0);
      setFaceStatus('Wajah Terdeteksi');
      setExitGraceSecondsLeft(null);
      setExitGraceReturned(false);
      setLastExitSource('');
      setSecurityBanner(null);
      setMediaLockedReason(null);
      const initialDurationSeconds = Math.max(60, targetExam.durasiMenit * 60);
      examDeadlineMsRef.current = Date.now() + initialDurationSeconds * 1000;
      setRemainingSeconds(initialDurationSeconds);

      // Publish initial live_streams entry immediately
      await onUpsertLiveStream({
        sessionId: newSessionId,
        namaSiswa: namaSiswa.trim(),
        noPeserta: noPeserta.trim() || undefined,
        kelas,
        mataPelajaran: targetExam.mataPelajaran,
        judulUjian: targetExam.judulUjian,
        examId: targetExam.id,
        status: 'aktif',
        audioLevel: 0,
        pelanggaranTab: 0,
        peringatanWajah: 0,
        lastFaceStatus: 'Wajah Terdeteksi',
        updatedAt: Date.now(),
      });

      setStage('exam');
      onExamActiveChange(true);

      // Force alarm check beep on exam start so student knows security audio is active
      playWarningBeep();

      // Request fullscreen gently
      document.documentElement.requestFullscreen?.().catch(() => {});
    } catch {
      setLobbyError(
        'Akses KAMERA DEPAN dan MIKROFON wajib diizinkan untuk mengikuti ujian CBT ini.'
      );
    } finally {
      setStartingExam(false);
    }
  };

  const handleReactivateMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 320, height: 240 },
        audio: true,
      });
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaLockedReason(null);
    } catch {
      setMediaLockedReason('Izin kamera dan mikrofon masih ditolak. Mohon aktifkan di pengaturan browser.');
    }
  };

  const setAnswerForQuestion = (q: Question, value: string) => {
    setAnswersMap((prev) => {
      if (q.tipe === 'PG_KOMPLEKS') {
        const current = prev[q.id] || [];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [q.id]: next };
      }
      return { ...prev, [q.id]: [value] };
    });
  };

  const persistentAudioElement = (
    <audio
      ref={alarmAudioRef}
      src={alarmAudioSrc}
      loop
      playsInline
      preload="auto"
      className="hidden"
      data-testid="persistent-alarm-audio"
      aria-label="Alarm Keamanan Ujian"
    />
  );

  const selectedExamPreview = useMemo(
    () => availableExams.find((e) => e.id === selectedExamId) || null,
    [availableExams, selectedExamId]
  );

  const filteredScheduleList = useMemo(() => {
    const q = scheduleSearch.trim().toLowerCase();
    if (!q) return availableExams;
    return availableExams.filter(
      (ex) =>
        ex.mataPelajaran.toLowerCase().includes(q) ||
        ex.judulUjian.toLowerCase().includes(q)
    );
  }, [availableExams, scheduleSearch]);

  // Keyboard navigation in Active Exam (ArrowLeft / ArrowRight outside input/textarea)
  useEffect(() => {
    if (stage !== 'exam' || examQuestions.length === 0) return;
    const handleKeyNav = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        setCurrentIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        setCurrentIdx((i) => Math.min(examQuestions.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', handleKeyNav);
    return () => window.removeEventListener('keydown', handleKeyNav);
  }, [stage, examQuestions.length]);

  // --- STAGE 1: STUDENT LOBBY ---
  if (stage === 'lobby') {
    const isNameReady = namaSiswa.trim().length > 0;
    const isExamReady = Boolean(selectedExamPreview);
    const isTokenReady = tokenInput.trim().length >= 4;
    const completedSteps = [isNameReady, isExamReady, isTokenReady].filter(Boolean).length;

    return (
      <>
        {persistentAudioElement}
        <main className="mx-auto max-w-7xl px-3.5 sm:px-6 py-4 sm:py-8 panel-enter">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6 items-stretch">
            {/* Left: Login Ujian Form + Interactive Readiness Tracker */}
            <div className="md:col-span-7 surface-card rounded-3xl p-5 sm:p-7 lg:p-8 flex flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-600">
                    Portal Peserta Ujian &middot; MTs Nurul Hijrah
                  </span>
                  <span
                    className={`font-semibold ${
                      cloudConnected ? 'text-emerald-800' : 'text-amber-800'
                    }`}
                  >
                    {cloudConnected ? 'Tersinkron Cloud Real-Time' : 'Mode Penyimpanan Lokal'}
                  </span>
                </div>

                <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
                  Masuk Ruang Ujian CBT
                </h1>
                <p className="mt-1.5 text-sm text-slate-600">
                  Lengkapi identitas peserta, pilih jadwal ujian yang dibuka pengawas, lalu masukkan kode token.
                </p>

                {/* Interactive 3-Step Readiness Progress Bar */}
                <div className="glass-subtle mt-5 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between text-xs mb-2.5">
                    <span className="font-semibold text-slate-700">Kesiapan Masuk Ruang Ujian</span>
                    <span className="font-mono-tabular font-bold text-emerald-800">
                      {completedSteps}/3 langkah siap
                    </span>
                  </div>
                  <div className="flex flex-wrap sm:grid sm:grid-cols-3 gap-1.5 sm:gap-2 text-[11px] sm:text-xs">
                    <div
                      className={`flex flex-1 min-w-fit items-center gap-1.5 sm:gap-2 rounded-xl border px-2 sm:px-2.5 py-1.5 sm:py-2 transition-colors duration-200 ${
                        isNameReady
                          ? 'border-emerald-400/60 bg-white/75 text-emerald-900 font-semibold shadow-xs'
                          : 'border-white/50 bg-white/30 text-slate-600'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-md sm:rounded-lg font-mono-tabular text-[10px] sm:text-[11px] font-bold transition-colors ${
                          isNameReady ? 'bg-emerald-700 text-white' : 'bg-white/70 text-slate-600'
                        }`}
                      >
                        {isNameReady ? <Check className="h-3 w-3" /> : '1'}
                      </span>
                      <span className="whitespace-nowrap">Identitas</span>
                    </div>
                    <div
                      className={`flex flex-1 min-w-fit items-center gap-1.5 sm:gap-2 rounded-xl border px-2 sm:px-2.5 py-1.5 sm:py-2 transition-colors duration-200 ${
                        isExamReady
                          ? 'border-emerald-400/60 bg-white/75 text-emerald-900 font-semibold shadow-xs'
                          : 'border-white/50 bg-white/30 text-slate-600'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-md sm:rounded-lg font-mono-tabular text-[10px] sm:text-[11px] font-bold transition-colors ${
                          isExamReady ? 'bg-emerald-700 text-white' : 'bg-white/70 text-slate-600'
                        }`}
                      >
                        {isExamReady ? <Check className="h-3 w-3" /> : '2'}
                      </span>
                      <span className="whitespace-nowrap">Jadwal</span>
                    </div>
                    <div
                      className={`flex flex-1 min-w-fit items-center gap-1.5 sm:gap-2 rounded-xl border px-2 sm:px-2.5 py-1.5 sm:py-2 transition-colors duration-200 ${
                        isTokenReady
                          ? 'border-emerald-400/60 bg-white/75 text-emerald-900 font-semibold shadow-xs'
                          : 'border-white/50 bg-white/30 text-slate-600'
                      }`}
                    >
                      <span
                        className={`flex h-4 w-4 sm:h-5 sm:w-5 shrink-0 items-center justify-center rounded-md sm:rounded-lg font-mono-tabular text-[10px] sm:text-[11px] font-bold transition-colors ${
                          isTokenReady ? 'bg-emerald-700 text-white' : 'bg-white/70 text-slate-600'
                        }`}
                      >
                        {isTokenReady ? <Check className="h-3 w-3" /> : '3'}
                      </span>
                      <span className="whitespace-nowrap">Token</span>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleStartExam} className="mt-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="sm:col-span-2">
                      <label htmlFor="student-name" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Nama Lengkap Siswa
                      </label>
                      <input
                        id="student-name"
                        type="text"
                        value={namaSiswa}
                        onChange={(e) => setNamaSiswa(e.target.value)}
                        placeholder="Ketik nama lengkap sesuai daftar hadir..."
                        className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm text-slate-900"
                      />
                    </div>
                    <div>
                      <label htmlFor="student-number" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        No. Peserta Ujian
                      </label>
                      <input
                        id="student-number"
                        type="text"
                        value={noPeserta}
                        onChange={(e) => setNoPeserta(e.target.value)}
                        placeholder="Opsional (mis. 01-0024)"
                        className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm font-mono-tabular text-slate-900 placeholder:font-sans"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="student-class" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Kelas
                      </label>
                      <select
                        id="student-class"
                        value={kelas}
                        onChange={(e) => setKelas(e.target.value)}
                        className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm text-slate-900"
                      >
                        {classes.length === 0 && <option value="">Belum ada kelas</option>}
                        {classes.map((c) => (
                          <option key={c.id} value={c.nama}>
                            {c.nama}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="student-token" className="block text-xs font-semibold text-slate-700 mb-1.5">
                        Token Ujian
                      </label>
                      <input
                        ref={tokenInputRef}
                        id="student-token"
                        type="text"
                        value={tokenInput}
                        onChange={(e) => setTokenInput(e.target.value.toUpperCase())}
                        placeholder="Ketik kode token"
                        className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm font-mono-tabular font-bold uppercase tracking-widest text-slate-900 placeholder:font-sans placeholder:font-normal placeholder:normal-case placeholder:tracking-normal"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="student-exam" className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Jadwal Ujian &amp; Mata Pelajaran Aktif
                    </label>
                    <select
                      id="student-exam"
                      value={selectedExamId}
                      onChange={(e) => setSelectedExamId(e.target.value)}
                      className="glass-input w-full rounded-xl px-3.5 py-2.5 text-sm text-slate-900"
                    >
                      {availableExams.length === 0 ? (
                        <option value="">-- Belum ada jadwal ujian aktif untuk kelas ini --</option>
                      ) : (
                        availableExams.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.mataPelajaran} — {ex.judulUjian} ({ex.questionsSnapshot.length} soal · {ex.durasiMenit} menit)
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  {selectedExamPreview && (
                    <div className="glass-subtle rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-emerald-800">
                          {selectedExamPreview.mataPelajaran}
                        </p>
                        <p className="font-display text-sm font-bold text-slate-900 truncate">
                          {selectedExamPreview.judulUjian}
                        </p>
                      </div>
                      <span className="font-mono-tabular text-xs font-bold text-slate-800 shrink-0">
                        {selectedExamPreview.questionsSnapshot.length} soal &middot;{' '}
                        {selectedExamPreview.durasiMenit} menit
                      </span>
                    </div>
                  )}

                  {lobbyError && (
                    <div className="rounded-xl border border-red-300/70 bg-red-500/15 backdrop-blur-xs px-3.5 py-2.5 text-xs font-medium text-red-900">
                      {lobbyError}
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={startingExam || availableExams.length === 0}
                      className="btn-press min-h-[46px] flex-1 sm:min-w-[220px] flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-[0_10px_24px_-10px_rgba(4,120,87,0.6)] hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      <Camera className="h-4 w-4 shrink-0" />
                      <span>
                        {startingExam
                          ? 'Mengaktifkan Kamera & Mikrofon...'
                          : 'Mulai Ujian Sekarang'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={previewChecking}
                      onClick={handleToggleHardwarePreview}
                      className={`btn-press min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-xs font-semibold whitespace-nowrap backdrop-blur-md ${
                        previewActive
                          ? 'border-red-300/70 bg-red-500/15 text-red-800 hover:bg-red-500/25'
                          : 'border-white/70 bg-white/55 text-slate-800 hover:bg-white/80'
                      }`}
                    >
                      {previewActive ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4 text-emerald-700" />}
                      <span>
                        {previewChecking
                          ? 'Memeriksa...'
                          : previewActive
                            ? 'Tutup Tes Kamera'
                            : 'Tes Kamera & Mic'}
                      </span>
                    </button>
                  </div>

                  {/* Interactive Pre-Exam Camera & Microphone Check */}
                  {(previewActive || previewError) && (
                    <div className="glass-subtle rounded-2xl p-3.5 panel-enter">
                      {previewError ? (
                        <div className="flex items-start justify-between gap-3 text-xs text-amber-900">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                            <span>{previewError}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPreviewError(null)}
                            aria-label="Tutup pesan perangkat"
                            className="btn-press rounded-lg p-1 text-slate-500 hover:bg-white/60 hover:text-slate-800"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-4">
                          <video
                            ref={previewVideoRef}
                            autoPlay
                            playsInline
                            muted
                            className="h-20 w-28 rounded-xl border border-white/60 bg-slate-950 object-cover shrink-0 shadow-xs"
                          />
                          <div className="flex-1 min-w-0 space-y-2 text-xs">
                            <p className="font-semibold text-emerald-900">
                              Kamera dan mikrofon siap digunakan untuk ujian
                            </p>
                            <div>
                              <div className="flex justify-between text-[11px] text-slate-600 mb-1">
                                <span>Tes level suara mikrofon</span>
                                <span className="font-mono-tabular">{previewAudioLevel}%</span>
                              </div>
                              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/60">
                                <div
                                  className="h-full w-full origin-left bg-emerald-600 transition-transform duration-150"
                                  style={{ transform: `scaleX(${Math.max(0.04, previewAudioLevel / 100)})` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </form>
              </div>
            </div>

            {/* Right: Interactive Schedule Quick-Pick, Security Rules & PWA Card */}
            <div className="md:col-span-5 flex flex-col gap-5">
              {/* Clickable Quick Exam Switcher for Selected Class */}
              <div className="surface-card rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-sm font-bold text-slate-900 flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-emerald-700 shrink-0" />
                    <span>Jadwal Terbuka ({kelas || 'Semua'})</span>
                  </h2>
                  <span className="font-mono-tabular text-xs font-semibold text-slate-600">
                    {availableExams.length} aktif
                  </span>
                </div>

                {availableExams.length > 2 && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={scheduleSearch}
                      onChange={(e) => setScheduleSearch(e.target.value)}
                      placeholder="Cari mata pelajaran atau judul tes..."
                      className="glass-input w-full rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900"
                    />
                  </div>
                )}

                {availableExams.length === 0 ? (
                  <p className="text-xs text-slate-600">
                    Belum ada jadwal ujian aktif untuk kelas {kelas}. Hubungi guru atau admin.
                  </p>
                ) : filteredScheduleList.length === 0 ? (
                  <p className="text-xs text-slate-600">
                    Tidak ada jadwal yang cocok dengan kata kunci &ldquo;{scheduleSearch}&rdquo;.
                  </p>
                ) : (
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-0.5">
                    {filteredScheduleList.map((ex) => {
                      const isSelected = ex.id === selectedExamId;
                      return (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => {
                            setSelectedExamId(ex.id);
                            tokenInputRef.current?.focus();
                          }}
                          className={`btn-press w-full rounded-2xl border px-3.5 py-2.5 text-left transition-colors ${
                            isSelected
                              ? 'border-emerald-500/60 bg-emerald-500/15 shadow-xs'
                              : 'border-white/60 bg-white/40 hover:bg-white/70'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {ex.mataPelajaran}
                            </span>
                            <span className="font-mono-tabular text-[11px] font-semibold text-emerald-800 shrink-0">
                              {ex.durasiMenit} mnt
                            </span>
                          </div>
                          <p className="truncate text-[11px] text-slate-600 mt-0.5">
                            {ex.judulUjian} &middot; {ex.questionsSnapshot.length} soal
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tata Tertib Pengawasan Live CBT */}
              <div className="surface-card rounded-3xl p-5 space-y-3">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Tata Tertib Pengawasan Live CBT
                </h2>
                <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed">
                  <li className="flex items-start gap-2.5">
                    <Camera className="h-4 w-4 shrink-0 text-emerald-700 mt-0.5" />
                    <span>
                      Kamera depan &amp; mikrofon wajib menyala selama ujian untuk pengawasan langsung.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Volume2 className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                    <span>
                      Keluar aplikasi atau pindah tab memicu <strong>alarm keras</strong> serta hitung mundur <strong>30 detik</strong> untuk kembali.
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
                    <span>
                      Batas keluar maksimal <strong>3x</strong>. Lebih dari 3x atau lewat 30 detik, jawaban dikirim otomatis sebagai <strong>Pelanggaran</strong>.
                    </span>
                  </li>
                </ul>
              </div>

              {/* Mobile PWA Install Card (iOS Dark Glass) */}
              <div className="glass-dark flex-1 rounded-3xl p-5 text-white flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-emerald-300">
                    Aplikasi Mobile Siswa
                  </p>
                  <h3 className="mt-1 font-display text-base font-bold">Scan QR Install di HP</h3>
                  <p className="mt-1.5 text-xs text-slate-200 leading-relaxed">
                    Pasang CBT MTs Nurul Hijrah ke layar utama Android atau iPhone untuk pengalaman ujian layar penuh.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onOpenQRInstall}
                  className="btn-press mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600/95 border border-emerald-400/35 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500 whitespace-nowrap"
                >
                  <QrCode className="h-4 w-4" />
                  <span>Tampilkan Kode QR Install</span>
                </button>
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  // --- STAGE 3: SUBMITTED SUMMARY ---
  if (stage === 'submitted' && submittedSummary) {
    return (
      <>
        {persistentAudioElement}
        <main className="mx-auto max-w-xl px-4 py-12 panel-enter">
          <div className="surface-card rounded-3xl p-8 text-center">
            <div
              className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl backdrop-blur-md ${
                submittedSummary.status === 'Selesai'
                  ? 'bg-emerald-500/15 text-emerald-800 border border-emerald-400/50'
                  : 'bg-red-500/15 text-red-700 border border-red-400/50'
              }`}
            >
              {submittedSummary.status === 'Selesai' ? (
                <CheckCircle2 className="h-8 w-8" />
              ) : (
                <ShieldAlert className="h-8 w-8" />
              )}
            </div>

            <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
              {submittedSummary.status === 'Selesai'
                ? 'Terima Kasih, Jawaban Berhasil Dikirim'
                : 'Ujian Dihentikan & Jawaban Terkirim'}
            </h1>
            <p className="mt-1.5 text-sm text-slate-600">{submittedSummary.alasanSubmit}</p>

            {submittedSummary.status === 'Pelanggaran' && persistentAlarmOnSummary && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-400/70 bg-red-500/15 backdrop-blur-md px-4 py-3 text-left">
                <div className="flex items-center gap-2 text-xs font-bold text-red-900">
                  <Volume2 className="h-4 w-4 shrink-0 text-red-600" />
                  <span>Alarm pelanggaran sedang berbunyi keras.</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    stopLoudSiren();
                    setPersistentAlarmOnSummary(false);
                  }}
                  className="btn-press rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 whitespace-nowrap"
                >
                  Matikan Alarm
                </button>
              </div>
            )}

            <div className="glass-subtle mt-6 rounded-2xl p-4 text-left text-xs space-y-2.5">
              <div className="flex justify-between">
                <span className="text-slate-600">Nama Peserta</span>
                <span className="font-semibold text-slate-900">{submittedSummary.namaSiswa}</span>
              </div>
              {submittedSummary.noPeserta && (
                <div className="flex justify-between">
                  <span className="text-slate-600">No. Peserta Ujian</span>
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {submittedSummary.noPeserta}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-600">Kelas / Mapel</span>
                <span className="font-semibold text-slate-900">
                  {submittedSummary.kelas} &middot; {submittedSummary.mataPelajaran}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">Status Pengumpulan</span>
                <span
                  className={`font-bold ${
                    submittedSummary.status === 'Selesai' ? 'text-emerald-800' : 'text-red-700'
                  }`}
                >
                  {submittedSummary.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran'}
                </span>
              </div>
              {(submittedSummary.peringatanWajah ?? 0) > 0 && (
                <div className="flex justify-between">
                  <span className="text-slate-600">Catatan Kamera / Wajah</span>
                  <span className="font-mono-tabular font-semibold text-amber-800">
                    {submittedSummary.peringatanWajah}x terdeteksi
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-white/50 pt-2.5">
                <span className="text-slate-600">Skor Objektif Sementara</span>
                <span className="font-mono-tabular text-base font-bold text-emerald-800">
                  {submittedSummary.skorPG}
                </span>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={() => printStudentExamReceipt(submittedSummary, activeExam || undefined)}
                className="btn-press inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/75 bg-white/75 px-4 py-3 text-xs font-bold text-slate-800 hover:bg-white"
              >
                <Printer className="h-4 w-4 text-emerald-700" />
                <span>Cetak / Simpan Bukti Jawaban</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  stopLoudSiren();
                  setPersistentAlarmOnSummary(false);
                  setStage('lobby');
                  setSubmittedSummary(null);
                  setTokenInput('');
                }}
                className="btn-press flex-1 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Kembali ke Beranda Ujian
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  // --- STAGE 2: ACTIVE EXAM VIEW ---
  const currentQ = examQuestions[currentIdx];
  const mins = Math.floor(remainingSeconds / 60);
  const secs = remainingSeconds % 60;
  const answeredCount = examQuestions.filter((q) => (answersMap[q.id]?.length || 0) > 0).length;
  const doubtfulCount = examQuestions.filter((q) => Boolean(doubtfulMap[q.id])).length;
  const unansweredCount = examQuestions.length - answeredCount;
  const progressPercent =
    examQuestions.length > 0 ? Math.round((answeredCount / examQuestions.length) * 100) : 0;

  const filteredNavItems = examQuestions
    .map((q, idx) => ({ q, idx }))
    .filter(({ q }) => {
      const isAnswered = (answersMap[q.id]?.length || 0) > 0;
      const isDoubtful = Boolean(doubtfulMap[q.id]);
      if (navFilter === 'UNANSWERED') return !isAnswered;
      if (navFilter === 'DOUBTFUL') return isDoubtful;
      return true;
    });

  const handleResumeAfterExit = () => {
    exitStartedAtRef.current = null;
    setExitGraceSecondsLeft(null);
    setExitGraceReturned(false);
    setSecurityBanner(null);
    stopLoudSiren();
    if (activeExam) {
      violationHistoryRef.current = markLastViolationReturned({
        examId: activeExam.id,
        namaSiswa,
        kelas,
      });
    }
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <>
      {persistentAudioElement}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-5 select-none panel-enter">
        {/* Hidden canvas for lightweight proctor preview snapshot */}
        <canvas ref={snapshotCanvasRef} className="hidden" />

        {/* Urgent 30-Second Return Countdown & Loud Alarm Modal */}
        {exitGraceSecondsLeft !== null && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-red-950/75 p-4 backdrop-blur-md"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="exit-alarm-title"
          >
            <div className="glass-modal w-full max-w-md border-2 border-red-400/80 p-6 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-600 border border-red-300/60">
                <AlertTriangle className="h-8 w-8" />
              </div>

              <h2 id="exit-alarm-title" className="mt-3 font-display text-lg font-extrabold text-red-700">
                PERINGATAN! TERDETEKSI KELUAR APLIKASI
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-600">
                Sumber: {lastExitSource || 'Keluar Layar Ujian'}
              </p>

              <div className="mt-4 rounded-2xl border border-red-300/70 bg-red-500/10 px-4 py-3">
                {exitGraceReturned ? (
                  <p className="text-xs font-bold text-emerald-800">
                    Anda telah kembali dalam batas waktu 30 detik. Klik tombol di bawah untuk mematikan alarm &amp; melanjutkan ujian.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700">
                      Sisa Waktu Kembali ke Ujian
                    </p>
                    <p
                      className="mt-1 font-mono-tabular text-4xl font-black text-red-600"
                      data-testid="exit-grace-countdown"
                    >
                      {exitGraceSecondsLeft} detik
                    </p>
                  </>
                )}
              </div>

              <div className="glass-subtle mt-3 flex items-center justify-between rounded-xl px-3.5 py-2 text-xs font-mono-tabular">
                <span className="text-slate-600">Kesempatan Keluar:</span>
                <span className="font-bold text-red-700">
                  {tabViolations} / {MAX_APP_EXIT_CHANCES} (Sisa {Math.max(0, MAX_APP_EXIT_CHANCES - tabViolations)}x)
                </span>
              </div>

              <p className="mt-2.5 text-[11px] leading-relaxed text-slate-600">
                Jika tidak kembali sebelum 30 detik habis atau keluar lebih dari 3x, jawaban otomatis dikirim sebagai <strong>Pelanggaran</strong>.
              </p>

              <button
                type="button"
                onClick={handleResumeAfterExit}
                className="btn-press mt-5 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800"
              >
                Lanjutkan Ujian &amp; Matikan Alarm
              </button>
            </div>
          </div>
        )}

        {/* Blocking Media Lock Modal if camera or microphone disabled */}
        {mediaLockedReason && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
          >
            <div className="glass-modal w-full max-w-md border-red-300/70 p-6 text-center">
              <Lock className="mx-auto h-10 w-10 text-red-600" />
              <h2 className="mt-3 font-display text-lg font-bold text-slate-900">
                Lembar Soal Dikunci Sementara
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{mediaLockedReason}</p>
              <button
                type="button"
                onClick={handleReactivateMedia}
                className="btn-press mt-5 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"
              >
                Aktifkan Kembali Kamera &amp; Mikrofon
              </button>
            </div>
          </div>
        )}

        {/* Timer Toast (15 mins / 5 mins) */}
        {timerToast && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-amber-300/80 bg-amber-50/85 backdrop-blur-md px-4 py-3 text-xs font-bold text-amber-900 shadow-sm panel-enter">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-700" />
              <span>{timerToast}</span>
            </div>
            <button
              type="button"
              onClick={() => setTimerToast(null)}
              className="btn-press rounded-lg px-2 py-1 text-amber-800 hover:bg-amber-200/50"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Security Warning Banner */}
        {securityBanner && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-red-400/80 bg-red-50/85 backdrop-blur-md px-4 py-3 text-xs font-bold text-red-900 shadow-sm panel-enter">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 shrink-0 text-red-600" />
              <span>{securityBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                stopLoudSiren();
                setSecurityBanner(null);
              }}
              className="btn-press rounded-xl bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700"
            >
              Saya Mengerti
            </button>
          </div>
        )}

        {/* Modern iOS Glass Exam Header Strip with Floating Corner Timer */}
        <div className="surface-card rounded-2xl mb-5 px-4 sm:px-5 py-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="font-display text-base font-bold text-slate-900 truncate">
                {activeExam?.judulUjian}
              </h1>
              <p className="text-xs text-slate-600 truncate">
                {activeExam?.mataPelajaran} &middot; {namaSiswa} ({kelas})
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <div className="text-right pr-2.5 border-r border-white/60">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Progres
                </p>
                <p className="font-mono-tabular text-xs font-bold text-slate-900">
                  {answeredCount}/{examQuestions.length} ({progressPercent}%)
                </p>
              </div>

              {/* Sleek Elevated Frosted Timer Badge */}
              <div
                className={`flex items-center gap-2 rounded-xl px-3.5 py-2 font-mono-tabular text-sm font-bold backdrop-blur-md shadow-xs border transition-colors ${
                  remainingSeconds <= 300
                    ? 'bg-red-500/20 text-red-800 border-red-400/70'
                    : 'bg-white/75 text-emerald-800 border-white/80'
                }`}
              >
                <Clock className="h-4 w-4 shrink-0" />
                <span>
                  {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
                </span>
              </div>

              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById('student-question-navigator')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className="btn-press lg:hidden min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-white/75 bg-white/75 px-3 py-2 text-xs font-bold text-slate-800 hover:bg-white whitespace-nowrap"
              >
                <span>Daftar Soal</span>
              </button>

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleUnifiedSubmit('Pelanggaran', 'Paksa Keluar Darurat oleh Siswa')}
                className="btn-press min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-red-600/95 px-3.5 py-2 text-xs font-bold text-white hover:bg-red-700 whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Paksa Keluar</span>
              </button>
            </div>
          </div>

          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/60">
            <div
              className="h-full w-full origin-left bg-emerald-600 transition-transform duration-300"
              style={{ transform: `scaleX(${Math.max(0, Math.min(1, progressPercent / 100))})` }}
            />
          </div>
        </div>

        {/* Main Split Workspace (8-col Focus Question Card + 4-col Proctoring & Navigator) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Question Card (Denser Frosted Reading Layer for Razor-Sharp Legibility) */}
          <div className="lg:col-span-8 exam-reading-surface rounded-3xl p-5 sm:p-7 flex flex-col justify-between">
            {currentQ && (
              <div key={currentQ.id} className={questionSlideClass}>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/75 pb-3.5">
                  <div className="flex items-center gap-2.5 text-xs">
                    <span className="rounded-xl bg-slate-950/90 border border-white/30 px-3 py-1 font-mono-tabular font-bold text-white shadow-xs">
                      Soal {currentIdx + 1} / {examQuestions.length}
                    </span>
                    <span className="font-semibold text-slate-800">
                      {currentQ.tipe === 'PG' && 'Pilihan Ganda'}
                      {currentQ.tipe === 'PG_KOMPLEKS' && 'Pilihan Ganda Kompleks (Pilih > 1)'}
                      {currentQ.tipe === 'BENAR_SALAH' && 'Benar / Salah'}
                      {currentQ.tipe === 'ESAI' && 'Esai / Uraian'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Interactive Reading Size Zoom */}
                    <div className="glass-subtle inline-flex items-center rounded-xl p-0.5" role="group" aria-label="Ukuran huruf soal">
                      <button
                        type="button"
                        onClick={() =>
                          setFontScale((s) => (s === 'xlarge' ? 'large' : 'normal'))
                        }
                        disabled={fontScale === 'normal'}
                        className="btn-press rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white/80 disabled:opacity-40"
                        aria-label="Perkecil huruf soal"
                      >
                        A-
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setFontScale((s) => (s === 'normal' ? 'large' : 'xlarge'))
                        }
                        disabled={fontScale === 'xlarge'}
                        className="btn-press rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-white/80 disabled:opacity-40"
                        aria-label="Perbesar huruf soal"
                      >
                        A+
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setDoubtfulMap((prev) => ({ ...prev, [currentQ.id]: !prev[currentQ.id] }))
                      }
                      className={`btn-press inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        doubtfulMap[currentQ.id]
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'border border-white/75 bg-white/70 text-slate-800 hover:bg-white'
                      }`}
                    >
                      <Flag className="h-3.5 w-3.5" />
                      <span>Ragu-ragu</span>
                    </button>
                  </div>
                </div>

                <div
                  className={`rich-question-content mt-5 leading-relaxed text-slate-950 ${
                    fontScale === 'xlarge'
                      ? 'text-xl'
                      : fontScale === 'large'
                        ? 'text-lg'
                        : 'text-base'
                  }`}
                  dangerouslySetInnerHTML={{ __html: currentQ.pertanyaanHtml }}
                />

                {/* Interactive Glass Answer Option Cards */}
                <div className="mt-6 space-y-2.5">
                  {(currentQ.tipe === 'PG' ||
                    currentQ.tipe === 'PG_KOMPLEKS' ||
                    currentQ.tipe === 'BENAR_SALAH') &&
                    currentQ.opsi.map((optText, oIdx) => {
                      const value =
                        currentQ.tipe === 'BENAR_SALAH' ? optText : getOptionLetter(oIdx);
                      const selected = (answersMap[currentQ.id] || []).includes(value);
                      return (
                        <label
                          key={oIdx}
                          className={`liquid-option-card group flex cursor-pointer items-start gap-3 rounded-2xl border p-3.5 text-sm ${
                            selected
                              ? 'border-emerald-600/75 bg-emerald-50/90 font-semibold text-slate-950 shadow-[0_12px_26px_-12px_rgba(4,120,87,0.35)]'
                              : 'border-white/85 bg-white/80 text-slate-950 hover:-translate-y-0.5 hover:border-sky-300/90 hover:bg-white/95 hover:shadow-sm'
                          }`}
                        >
                          <input
                            type={currentQ.tipe === 'PG_KOMPLEKS' ? 'checkbox' : 'radio'}
                            name={`q-${currentQ.id}`}
                            checked={selected}
                            onChange={() => setAnswerForQuestion(currentQ, value)}
                            className="mt-0.5 h-4 w-4 accent-emerald-700 shrink-0"
                          />
                          {currentQ.tipe !== 'BENAR_SALAH' && (
                            <span
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono-tabular text-xs font-bold transition-colors ${
                                selected
                                  ? 'bg-emerald-700 text-white shadow-xs'
                                  : 'bg-slate-100/90 border border-slate-200/80 text-slate-800 group-hover:bg-sky-50'
                              }`}
                            >
                              {value}
                            </span>
                          )}
                          <span className="flex-1 pt-0.5 text-slate-950">{optText}</span>
                          {selected && <Check className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />}
                        </label>
                      );
                    })}

                  {currentQ.tipe === 'ESAI' && (
                    <div>
                      <label
                        htmlFor={`essay-${currentQ.id}`}
                        className="block text-xs font-semibold text-slate-700 mb-1.5"
                      >
                        Jawaban Uraian Anda:
                      </label>
                      <textarea
                        id={`essay-${currentQ.id}`}
                        rows={6}
                        value={(answersMap[currentQ.id] || [''])[0]}
                        onChange={(e) => setAnswerForQuestion(currentQ, e.target.value)}
                        placeholder="Ketik jawaban esai secara jelas dan lengkap di sini..."
                        className="glass-input w-full rounded-2xl p-3.5 text-sm text-slate-900"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Navigation Footer */}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/55 pt-4">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
                className="btn-press min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-white/70 bg-white/55 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/85 disabled:opacity-40 whitespace-nowrap"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Sebelumnya</span>
                <span className="kbd-hint hidden sm:inline-flex ml-1">&larr;</span>
              </button>

              <div className="flex items-center gap-2">
                {currentIdx < examQuestions.length - 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setCurrentIdx((i) => Math.min(examQuestions.length - 1, i + 1))
                    }
                    className="btn-press min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-slate-900/95 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                  >
                    <span className="kbd-hint hidden sm:inline-flex mr-1 bg-slate-800 border-slate-700 text-slate-200">&rarr;</span>
                    <span>Selanjutnya</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setShowConfirmSubmit(true)}
                    className="btn-press min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-800 whitespace-nowrap"
                  >
                    <Send className="h-4 w-4" />
                    <span>{isSubmitting ? 'Mengirim...' : 'Kirim Jawaban'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Live Proctoring HUD & Interactive Question Navigator */}
          <div className="lg:col-span-4 space-y-5 lg:sticky lg:top-20">
            {/* Live Video & Audio Proctoring Box */}
            <div className="surface-card rounded-3xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-xs font-bold text-slate-900">
                  Pengawasan Live Aktif
                </span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                  <Radio className="h-3.5 w-3.5" />
                  <span>LIVE</span>
                </span>
              </div>

              <div className="flex items-center gap-3">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-24 w-32 rounded-2xl border border-white/60 bg-slate-950 object-cover shrink-0 shadow-xs"
                />
                <div className="flex-1 min-w-0 space-y-2 text-xs">
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
                      <span className="inline-flex items-center gap-1">
                        <Mic className="h-3 w-3 text-emerald-700" />
                        <span>Mikrofon</span>
                      </span>
                      <span className="font-mono-tabular">{audioLevel}%</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/60">
                      <div
                        className="h-full w-full origin-left bg-emerald-600 transition-transform duration-150"
                        style={{ transform: `scaleX(${Math.max(0.05, audioLevel / 100)})` }}
                      />
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-700">
                    Kamera:{' '}
                    <strong
                      className={
                        faceStatus === 'Wajah Terdeteksi' ? 'text-emerald-800' : 'text-amber-800'
                      }
                    >
                      {faceStatus}
                    </strong>
                    {faceWarnings > 0 ? (
                      <span className="ml-1 font-mono-tabular text-amber-800">
                        ({faceWarnings}x)
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono-tabular pt-0.5">
                    <span>
                      Keluar:{' '}
                      <strong className={tabViolations > 0 ? 'text-red-700' : 'text-slate-900'}>
                        {tabViolations}/{MAX_APP_EXIT_CHANCES}
                      </strong>
                    </span>
                    <span className="text-slate-600">Batas: {APP_EXIT_GRACE_SECONDS} dtk</span>
                  </div>
                </div>
              </div>

              <div className="glass-subtle flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[11px] text-slate-700">
                <Volume2 className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                <span>Alarm keamanan otomatis aktif selama ujian berlangsung.</span>
              </div>
            </div>

            {/* Interactive Question Navigator Grid */}
            <div id="student-question-navigator" className="surface-card rounded-3xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xs font-bold text-slate-900">
                  Navigasi Nomor Soal
                </h2>
                <span className="text-[11px] font-mono-tabular text-slate-600">
                  {answeredCount}/{examQuestions.length} Terjawab
                </span>
              </div>

              {/* Filter Tabs for Fast Jump with Liquid Morphing Pill */}
              <div ref={filterNavRef} className="relative glass-subtle grid grid-cols-3 gap-1 rounded-xl p-1">
                <span
                  aria-hidden="true"
                  style={filterMorph.pillStyle}
                  className="liquid-morph-pill rounded-lg z-0"
                />
                <button
                  type="button"
                  data-morph-active={navFilter === 'ALL' ? 'true' : undefined}
                  onClick={() => setNavFilter('ALL')}
                  className={`btn-press relative z-10 rounded-lg py-1 text-[11px] font-semibold transition-colors ${
                    navFilter === 'ALL'
                      ? filterMorph.visible
                        ? 'text-slate-950'
                        : 'bg-white/85 text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Semua ({examQuestions.length})
                </button>
                <button
                  type="button"
                  data-morph-active={navFilter === 'UNANSWERED' ? 'true' : undefined}
                  onClick={() => setNavFilter('UNANSWERED')}
                  className={`btn-press relative z-10 rounded-lg py-1 text-[11px] font-semibold transition-colors ${
                    navFilter === 'UNANSWERED'
                      ? filterMorph.visible
                        ? 'text-slate-950'
                        : 'bg-white/85 text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Belum ({unansweredCount})
                </button>
                <button
                  type="button"
                  data-morph-active={navFilter === 'DOUBTFUL' ? 'true' : undefined}
                  onClick={() => setNavFilter('DOUBTFUL')}
                  className={`btn-press relative z-10 rounded-lg py-1 text-[11px] font-semibold transition-colors ${
                    navFilter === 'DOUBTFUL'
                      ? filterMorph.visible
                        ? 'text-amber-900 font-bold'
                        : 'bg-amber-500 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Ragu ({doubtfulCount})
                </button>
              </div>

              {filteredNavItems.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-600">
                  Tidak ada nomor soal pada filter ini.
                </p>
              ) : (
                <div ref={questionGridRef} className="relative grid grid-cols-5 gap-2">
                  <span
                    aria-hidden="true"
                    style={questionGridMorph.pillStyle}
                    className="liquid-morph-ring z-20"
                  />
                  {filteredNavItems.map(({ q, idx }) => {
                    const isAnswered = (answersMap[q.id]?.length || 0) > 0;
                    const isDoubtful = Boolean(doubtfulMap[q.id]);
                    const isCurrent = idx === currentIdx;

                    let cls = 'border-white/75 bg-white/55 text-slate-800 hover:bg-white/85';
                    if (isDoubtful) cls = 'border-amber-400/80 bg-amber-400/25 text-amber-950 font-bold';
                    else if (isAnswered)
                      cls = 'border-emerald-600 bg-emerald-700 text-white font-bold shadow-xs';

                    return (
                      <button
                        key={q.id}
                        type="button"
                        data-morph-active={isCurrent ? 'true' : undefined}
                        onClick={() => setCurrentIdx(idx)}
                        className={`btn-press relative z-10 h-9 rounded-xl border font-mono-tabular text-xs transition-colors ${cls} ${
                          isCurrent && !questionGridMorph.visible ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => setShowConfirmSubmit(true)}
                className="btn-press mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800"
              >
                <Send className="h-4 w-4" />
                <span>{isSubmitting ? 'Menyimpan Jawaban...' : 'Selesai & Kirim Jawaban'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Confirm Manual Submit Modal with Interactive Jump Breakdown */}
        {showConfirmSubmit && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-md"
            role="dialog"
            aria-modal="true"
          >
            <div className="glass-modal w-full max-w-md p-6">
              <h3 className="font-display text-base font-bold text-slate-900">
                Konfirmasi Kirim Jawaban Ujian
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Klik status di bawah jika ingin meninjau ulang soal sebelum mengumpulkan jawaban ke server.
              </p>

              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl border border-emerald-300/70 bg-emerald-500/15 p-3 text-center">
                  <p className="font-mono-tabular text-lg font-bold text-emerald-900">{answeredCount}</p>
                  <p className="text-[11px] font-medium text-emerald-800">Dijawab</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmSubmit(false);
                    setNavFilter('DOUBTFUL');
                    const firstDoubt = examQuestions.findIndex((q) => Boolean(doubtfulMap[q.id]));
                    if (firstDoubt >= 0) setCurrentIdx(firstDoubt);
                  }}
                  className="btn-press rounded-2xl border border-amber-300/70 bg-amber-500/15 p-3 text-center hover:bg-amber-500/25"
                >
                  <p className="font-mono-tabular text-lg font-bold text-amber-900">{doubtfulCount}</p>
                  <p className="text-[11px] font-medium text-amber-800">Ragu-ragu</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowConfirmSubmit(false);
                    setNavFilter('UNANSWERED');
                    const firstBlank = examQuestions.findIndex((q) => (answersMap[q.id]?.length || 0) === 0);
                    if (firstBlank >= 0) setCurrentIdx(firstBlank);
                  }}
                  className="btn-press rounded-2xl border border-white/70 bg-white/55 p-3 text-center hover:bg-white/85"
                >
                  <p className="font-mono-tabular text-lg font-bold text-slate-900">{unansweredCount}</p>
                  <p className="text-[11px] font-medium text-slate-700">Belum</p>
                </button>
              </div>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmSubmit(false)}
                  className="btn-press rounded-xl border border-white/70 bg-white/60 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-white/90"
                >
                  Periksa Kembali
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleUnifiedSubmit('Selesai', 'Dikirim manual oleh siswa')}
                  className="btn-press rounded-xl bg-emerald-700 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-800"
                >
                  {isSubmitting ? 'Menyimpan...' : 'Ya, Kirim Jawaban'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
};
