export type UserRole = 'siswa' | 'guru' | 'admin';

export type QuestionType = 'PG' | 'PG_KOMPLEKS' | 'BENAR_SALAH' | 'ESAI';

export interface SubjectItem {
  id: string;
  nama: string;
  kode: string;
  createdAt: string;
}

export interface ClassItem {
  id: string;
  nama: string;
  tingkat: string;
  createdAt: string;
}

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncStatusInfo {
  status: SyncStatus;
  pendingCount: number;
  queuedMutationsCount: number;
  lastSyncedAt: string | null;
  lastSyncSummary: string | null;
  errorMessage: string | null;
  cloudConnected: boolean;
}

export type SyncLogStatus = 'Berhasil' | 'Menunggu' | 'Gagal';

export type SyncLogEntity =
  | 'Mapel'
  | 'Kelas'
  | 'Guru'
  | 'Soal'
  | 'Jadwal'
  | 'Hasil Ujian'
  | 'Pengawasan'
  | 'Sistem';

export type SyncLogAction = 'Tambah' | 'Ubah' | 'Hapus' | 'Sinkron' | 'Paksa';

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  status: SyncLogStatus;
  entity: SyncLogEntity;
  action: SyncLogAction;
  actorRole: UserRole | 'sistem';
  actorName: string;
  summary: string;
  details: string;
  collection: string;
  deviceId: string;
  errorMessage?: string;
}

export interface TeacherAccount {
  id: string;
  nama: string;
  mataPelajaran: string;
  mataPelajaranList?: string[];
  usernameHash: string;
  usernameMasked: string;
  passwordHash: string;
  aktif: boolean;
  createdAt: string;
}

export interface AdminAccount {
  id: string;
  nama: string;
  usernameHash: string;
  passwordHash: string;
  createdAt: string;
}

export interface Question {
  id: string;
  mataPelajaran: string;
  tipe: QuestionType;
  pertanyaanHtml: string;
  opsi: string[]; // For PG (A-E), PG_KOMPLEKS (A-E), BENAR_SALAH (['Benar','Salah']), ESAI ([])
  kunciJawaban: string[]; // e.g. ['A'] or ['A','C'] or ['Benar'] or ['keyword']
  bobot: number;
  createdBy: string;
  createdAt: string;
}

export interface ExamSchedule {
  id: string;
  judulUjian: string;
  mataPelajaran: string;
  kelasTarget: string[]; // ['VII A', 'VII B'] or ['Semua Kelas']
  durasiMenit: number;
  token: string;
  aktif: boolean;
  acakSoal: boolean;
  questionsSnapshot: Question[]; // Deep snapshot saved when schedule is created/updated
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export type ExamSubmissionStatus = 'Selesai' | 'Pelanggaran';

export interface StudentAnswerDetail {
  questionId: string;
  tipe: QuestionType;
  jawaban: string[]; // e.g. ['A'] or ['A','C'] or ['teks esai']
  raguRagu?: boolean;
  benar?: boolean;
  skorDiperoleh?: number;
}

export interface ViolationLogEntry {
  id: string;
  strikeNumber: number;
  timestamp: string;
  reason: string;
  returnedAt?: string;
  durationAwaySeconds?: number;
}

export interface ExamResult {
  id: string;
  examId: string;
  namaSiswa: string;
  noPeserta?: string;
  kelas: string;
  mataPelajaran: string;
  judulUjian: string;
  skorPG: number;
  skorEsai: number;
  nilaiAkhir: number;
  jawabanDetail: StudentAnswerDetail[];
  waktuSubmit: string;
  status: ExamSubmissionStatus;
  pelanggaranTab: number;
  peringatanWajah?: number;
  alasanSubmit?: string;
  violationHistory?: ViolationLogEntry[];
}

export interface LiveStreamSession {
  sessionId: string;
  namaSiswa: string;
  noPeserta?: string;
  kelas: string;
  mataPelajaran: string;
  judulUjian: string;
  examId: string;
  status: 'aktif' | 'terputus' | 'selesai';
  audioLevel: number; // 0 - 100
  pelanggaranTab: number;
  peringatanWajah?: number;
  lastFaceStatus?: string;
  offerSdp?: string;
  answerSdp?: string;
  studentIceCandidates?: string[];
  proctorIceCandidates?: string[];
  snapshotPreview?: string; // Lightweight fallback preview frame
  proctorWarningMessage?: string;
  proctorAlarmTriggerAt?: number;
  updatedAt: number;
}
