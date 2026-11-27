import type { UserRole } from '../types/cbt';

export type PetCharacterId = 'cat' | 'owl' | 'elephant' | 'fox';

export type PetMood =
  | 'idle'
  | 'happy'
  | 'proud'
  | 'focused'
  | 'bored'
  | 'sleeping'
  | 'concerned'
  | 'thinking';

export type PetActivityEvent =
  | 'exam_submitted_normal'
  | 'exam_submitted_violation'
  | 'proctor_warning'
  | 'exam_started'
  | 'questions_saved'
  | 'sheets_exported'
  | 'excel_exported'
  | 'schedule_toggled'
  | 'ai_command_success'
  | 'portal_switched';

export type ProctorAlertKind = 'teacher' | 'violation' | 'face';

export interface PetMoodMeta {
  id: PetMood;
  label: string;
  dotColor: string;
  pillTone: string;
  statusHint: string;
}

export const PET_MOODS: Record<PetMood, PetMoodMeta> = {
  idle: {
    id: 'idle',
    label: 'Santai',
    dotColor: 'bg-emerald-500',
    pillTone: 'border-white/80 bg-white/90 text-slate-700',
    statusHint: 'Siap membantu kapan saja',
  },
  happy: {
    id: 'happy',
    label: 'Senang',
    dotColor: 'bg-rose-500',
    pillTone: 'border-rose-200 bg-rose-50/95 text-rose-800',
    statusHint: 'Ceria merespons sentuhanmu!',
  },
  proud: {
    id: 'proud',
    label: 'Bangga!',
    dotColor: 'bg-amber-500',
    pillTone: 'border-amber-300 bg-amber-50/95 text-amber-900',
    statusHint: 'Bangga atas pencapaian & ujian selesai!',
  },
  focused: {
    id: 'focused',
    label: 'Fokus Ujian',
    dotColor: 'bg-sky-500',
    pillTone: 'border-sky-300 bg-sky-50/95 text-sky-900',
    statusHint: 'Mengawal ketenangan selama ujian',
  },
  bored: {
    id: 'bored',
    label: 'Bosan...',
    dotColor: 'bg-slate-400',
    pillTone: 'border-slate-300/90 bg-slate-100/95 text-slate-600',
    statusHint: 'Dasbor lama tidak disentuh',
  },
  sleeping: {
    id: 'sleeping',
    label: 'Mengantuk',
    dotColor: 'bg-indigo-400',
    pillTone: 'border-indigo-200 bg-indigo-50/95 text-indigo-800',
    statusHint: 'Zzz... istirahat sejenak',
  },
  concerned: {
    id: 'concerned',
    label: 'Waspada',
    dotColor: 'bg-orange-500',
    pillTone: 'border-orange-300 bg-orange-50/95 text-orange-900',
    statusHint: 'Memantau pelanggaran ujian',
  },
  thinking: {
    id: 'thinking',
    label: 'Berpikir',
    dotColor: 'bg-emerald-600',
    pillTone: 'border-emerald-300 bg-emerald-50/95 text-emerald-900',
    statusHint: 'Sedang memproses permintaan AI',
  },
};

export interface PetCharacterMeta {
  id: PetCharacterId;
  name: string;
  speciesLabel: string;
  tagline: string;
  greetingWords: string[];
  accentBg: string;
  accentText: string;
  ringColor: string;
}

export const PET_CHARACTERS: Record<PetCharacterId, PetCharacterMeta> = {
  cat: {
    id: 'cat',
    name: 'Miko',
    speciesLabel: 'Kucing Pintar',
    tagline: 'Lincah, ramah & siap bantu apa saja',
    greetingWords: [
      'Meow~ Ada yang bisa Miko bantu hari ini?',
      'Halo! Tanya atau beri perintah apa saja ke Miko ya!',
      'Semangat terus! Klik Miko kalau butuh bantuan.',
    ],
    accentBg: 'from-amber-200/80 via-orange-100/80 to-white/75',
    accentText: 'text-amber-900',
    ringColor: 'border-amber-300/80',
  },
  owl: {
    id: 'owl',
    name: 'Ollie',
    speciesLabel: 'Burung Hantu Bijak',
    tagline: 'Cerdas, fokus & suka membahas materi',
    greetingWords: [
      'Hoo~ Ollie siap bantu belajar & kelola ujian!',
      'Salam cerdas! Tanyakan materi atau perintah apa pun.',
      'Mata elang Ollie siap mengawal produktivitasmu!',
    ],
    accentBg: 'from-sky-200/80 via-indigo-100/80 to-white/75',
    accentText: 'text-sky-900',
    ringColor: 'border-sky-300/80',
  },
  elephant: {
    id: 'elephant',
    name: 'Bimo',
    speciesLabel: 'Gajah Mini',
    tagline: 'Ingatan kuat & penyabar menemani ujian',
    greetingWords: [
      'Paawoo~ Bimo ingat semuanya! Mau dibantu apa?',
      'Halo sahabat! Bimo siap bantu atur soal & materi.',
      'Tetap tenang ya, klik Bimo kalau butuh apa-apa!',
    ],
    accentBg: 'from-emerald-200/80 via-teal-100/80 to-white/75',
    accentText: 'text-emerald-900',
    ringColor: 'border-emerald-300/80',
  },
  fox: {
    id: 'fox',
    name: 'Kiko',
    speciesLabel: 'Rubah Ceria',
    tagline: 'Cepat tanggap, aktif & penuh ide kreatif',
    greetingWords: [
      'Yip! Kiko siap eksekusi perintahmu secepat kilat!',
      'Hai! Mau cari info, buat soal, atau buka menu?',
      'Klik Kiko kapan saja ya, Kiko siap sedia!',
    ],
    accentBg: 'from-rose-200/80 via-orange-100/80 to-white/75',
    accentText: 'text-rose-900',
    ringColor: 'border-rose-300/80',
  },
};

export const PET_CHARACTER_LIST: PetCharacterMeta[] = [
  PET_CHARACTERS.cat,
  PET_CHARACTERS.owl,
  PET_CHARACTERS.elephant,
  PET_CHARACTERS.fox,
];

export interface PetAppContextSummary {
  activeRole: UserRole;
  isExamLocked: boolean;
  isTeacherLoggedIn: boolean;
  teacherName?: string;
  teacherSubject?: string;
  isAdminLoggedIn: boolean;
  adminName?: string;
  currentTab?: string;
  subjects: string[];
  classes: string[];
  totalQuestions: number;
  activeExamsCount: number;
  activeExamsSummary: Array<{
    judulUjian: string;
    mataPelajaran: string;
    durasiMenit: number;
    token?: string;
    jumlahSoal: number;
  }>;
  totalResults: number;
  activeLiveCount: number;
}

export type PetClientAction =
  | { type: 'switch_portal'; role: UserRole }
  | { type: 'navigate_tab'; tab: string }
  | { type: 'change_pet_character'; pet: PetCharacterId }
  | { type: 'set_pet_visibility'; visible: boolean }
  | { type: 'open_qr_install' }
  | { type: 'open_create_question' }
  | { type: 'export_exam_results'; mataPelajaran?: string }
  | { type: 'export_google_sheets'; mataPelajaran?: string }
  | { type: 'create_subject'; nama: string; kode: string }
  | { type: 'create_class'; nama: string; tingkat: string }
  | { type: 'toggle_exam_schedule'; query: string; aktif?: boolean }
  | {
      type: 'prefill_student_entry';
      namaSiswa?: string;
      kelas?: string;
      mataPelajaran?: string;
      token?: string;
    }
  | {
      type: 'save_generated_questions';
      mataPelajaran: string;
      questions: Array<{
        tipe: 'PG' | 'PG_KOMPLEKS' | 'BENAR_SALAH' | 'ESAI';
        pertanyaanHtml: string;
        opsi: string[];
        kunciJawaban: string[];
        bobot: number;
      }>;
    }
  | { type: 'run_pet_trick'; trick: 'jump' | 'sleep' | 'hearts' | 'dance' };

export function clampPetPosition(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  widgetSize = 92,
  margin = 12
): { x: number; y: number } {
  const safeW = Math.max(widgetSize + margin * 2, viewportWidth || 390);
  const safeH = Math.max(widgetSize + margin * 2, viewportHeight || 844);
  const maxX = safeW - widgetSize - margin;
  const maxY = safeH - widgetSize - margin;
  return {
    x: Math.round(Math.min(Math.max(margin, x), maxX)),
    y: Math.round(Math.min(Math.max(margin, y), maxY)),
  };
}

export function getDefaultPetPosition(
  viewportWidth: number,
  viewportHeight: number,
  widgetSize = 92,
  margin = 20
): { x: number; y: number } {
  return clampPetPosition(
    (viewportWidth || 1280) - widgetSize - margin,
    (viewportHeight || 800) - widgetSize - margin,
    viewportWidth,
    viewportHeight,
    widgetSize,
    12
  );
}

export function isPetIdleSleeping(
  lastInteractionMs: number,
  nowMs: number,
  thresholdMs = 32000
): boolean {
  if (!Number.isFinite(lastInteractionMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastInteractionMs >= thresholdMs;
}

export interface ComputePetMoodInput {
  isLoading?: boolean;
  isHappyOverride?: boolean;
  isExamLocked?: boolean;
  lastInteractionMs: number;
  nowMs: number;
  lastEvent?: PetActivityEvent | null;
  lastEventAtMs?: number | null;
  boredThresholdMs?: number;
  sleepThresholdMs?: number;
  proudDurationMs?: number;
  concernedDurationMs?: number;
}

const PROUD_EVENTS: ReadonlySet<PetActivityEvent> = new Set([
  'exam_submitted_normal',
  'questions_saved',
  'sheets_exported',
  'excel_exported',
  'schedule_toggled',
  'ai_command_success',
]);

export function computePetMood(input: ComputePetMoodInput): PetMood {
  const {
    isLoading = false,
    isHappyOverride = false,
    isExamLocked = false,
    lastInteractionMs,
    nowMs,
    lastEvent = null,
    lastEventAtMs = null,
    boredThresholdMs = 14_000,
    sleepThresholdMs = 32_000,
    proudDurationMs = 45_000,
    concernedDurationMs = 35_000,
  } = input;

  if (isLoading) return 'thinking';
  if (isHappyOverride) return 'happy';

  if (lastEvent && typeof lastEventAtMs === 'number' && Number.isFinite(lastEventAtMs)) {
    const eventAge = Math.max(0, nowMs - lastEventAtMs);
    if (PROUD_EVENTS.has(lastEvent) && eventAge < proudDurationMs) {
      return 'proud';
    }
    if (
      (lastEvent === 'exam_submitted_violation' || lastEvent === 'proctor_warning') &&
      eventAge < concernedDurationMs
    ) {
      return 'concerned';
    }
  }

  if (isExamLocked) return 'focused';

  if (Number.isFinite(lastInteractionMs) && Number.isFinite(nowMs)) {
    const idleMs = Math.max(0, nowMs - lastInteractionMs);
    if (idleMs >= sleepThresholdMs) return 'sleeping';
    if (idleMs >= boredThresholdMs) return 'bored';
  }

  return 'idle';
}

export function shouldPlayProctorAlertAudio(params: {
  lastPlayedMs: number;
  nowMs: number;
  muted: boolean;
  kind?: ProctorAlertKind;
}): { shouldPlay: boolean; cooldownMs: number } {
  const kind = params.kind || 'teacher';
  const cooldownMs = kind === 'teacher' ? 1_200 : kind === 'violation' ? 2_500 : 5_000;
  if (params.muted) {
    return { shouldPlay: false, cooldownMs };
  }
  if (!Number.isFinite(params.lastPlayedMs) || params.lastPlayedMs <= 0) {
    return { shouldPlay: true, cooldownMs };
  }
  const elapsed = Math.max(0, params.nowMs - params.lastPlayedMs);
  return {
    shouldPlay: elapsed >= cooldownMs,
    cooldownMs,
  };
}

export function formatProctorPetAlertBubble(
  kind: ProctorAlertKind,
  detail?: string
): string {
  const cleanDetail = (detail || '').trim();
  if (kind === 'teacher') {
    return cleanDetail
      ? `Peringatan Pengawas: "${cleanDetail}"`
      : 'Ada peringatan baru dari pengawas ujian! Segera periksa layarmu.';
  }
  if (kind === 'violation') {
    return cleanDetail
      ? `Pelanggaran Terdeteksi: ${cleanDetail}`
      : 'Peringatan pengawasan! Jangan meninggalkan layar ujian.';
  }
  return cleanDetail
    ? `Perhatian Kamera: ${cleanDetail}`
    : 'Pastikan wajahmu terlihat jelas di kamera selama ujian berlangsung.';
}

export function isValidPetId(val: unknown): val is PetCharacterId {
  return val === 'cat' || val === 'owl' || val === 'elephant' || val === 'fox';
}

export function normalizePetActions(
  rawCalls: Array<{ name?: string; args?: Record<string, unknown> }>
): PetClientAction[] {
  const out: PetClientAction[] = [];

  for (const call of rawCalls) {
    const name = String(call?.name || '').trim();
    const args = (call?.args && typeof call.args === 'object' ? call.args : {}) as Record<
      string,
      unknown
    >;

    switch (name) {
      case 'switch_portal': {
        const role = String(args.role || '').toLowerCase();
        if (role === 'siswa' || role === 'guru' || role === 'admin') {
          out.push({ type: 'switch_portal', role });
        }
        break;
      }
      case 'navigate_tab': {
        const tab = String(args.tab || '').trim();
        if (tab) out.push({ type: 'navigate_tab', tab });
        break;
      }
      case 'change_pet_character': {
        const rawPet = String(args.pet || '').toLowerCase().trim();
        const aliasMap: Record<string, PetCharacterId> = {
          cat: 'cat',
          kucing: 'cat',
          owl: 'owl',
          burung: 'owl',
          'burung hantu': 'owl',
          elephant: 'elephant',
          gajah: 'elephant',
          fox: 'fox',
          rubah: 'fox',
          anjing: 'fox',
        };
        const mapped = aliasMap[rawPet];
        if (mapped) out.push({ type: 'change_pet_character', pet: mapped });
        break;
      }
      case 'set_pet_visibility': {
        out.push({ type: 'set_pet_visibility', visible: Boolean(args.visible) });
        break;
      }
      case 'open_qr_install': {
        out.push({ type: 'open_qr_install' });
        break;
      }
      case 'open_create_question': {
        out.push({ type: 'open_create_question' });
        break;
      }
      case 'export_exam_results': {
        const mp = typeof args.mataPelajaran === 'string' ? args.mataPelajaran.trim() : undefined;
        out.push({ type: 'export_exam_results', mataPelajaran: mp || undefined });
        break;
      }
      case 'export_google_sheets': {
        const mp = typeof args.mataPelajaran === 'string' ? args.mataPelajaran.trim() : undefined;
        out.push({ type: 'export_google_sheets', mataPelajaran: mp || undefined });
        break;
      }
      case 'create_subject': {
        const nama = String(args.nama || '').trim();
        const kode = String(args.kode || nama.slice(0, 5))
          .trim()
          .toUpperCase();
        if (nama) out.push({ type: 'create_subject', nama, kode });
        break;
      }
      case 'create_class': {
        const nama = String(args.nama || '').trim();
        const tingkat = String(args.tingkat || nama.split(/\s+/)[0] || 'VII')
          .trim()
          .toUpperCase();
        if (nama) out.push({ type: 'create_class', nama, tingkat });
        break;
      }
      case 'toggle_exam_schedule': {
        const query = String(args.query || '').trim();
        const aktif = typeof args.aktif === 'boolean' ? args.aktif : undefined;
        if (query) out.push({ type: 'toggle_exam_schedule', query, aktif });
        break;
      }
      case 'prefill_student_entry': {
        out.push({
          type: 'prefill_student_entry',
          namaSiswa: typeof args.namaSiswa === 'string' ? args.namaSiswa.trim() : undefined,
          kelas: typeof args.kelas === 'string' ? args.kelas.trim() : undefined,
          mataPelajaran:
            typeof args.mataPelajaran === 'string' ? args.mataPelajaran.trim() : undefined,
          token: typeof args.token === 'string' ? args.token.trim().toUpperCase() : undefined,
        });
        break;
      }
      case 'run_pet_trick': {
        const trick = String(args.trick || 'jump').toLowerCase();
        if (trick === 'jump' || trick === 'sleep' || trick === 'hearts' || trick === 'dance') {
          out.push({ type: 'run_pet_trick', trick });
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

export function buildPetSystemInstruction(
  petId: PetCharacterId,
  ctx?: Partial<PetAppContextSummary>
): string {
  const meta = PET_CHARACTERS[petId] || PET_CHARACTERS.cat;
  const role = ctx?.activeRole || 'siswa';
  const examLocked = Boolean(ctx?.isExamLocked);

  const appStateLines = [
    `- Portal aktif: ${role.toUpperCase()}`,
    `- Sedang ujian aktif (terkunci): ${examLocked ? 'YA (Siswa sedang mengerjakan ujian)' : 'TIDAK'}`,
    ctx?.isTeacherLoggedIn
      ? `- Akun Guru login: ${ctx.teacherName || 'Guru'} (Mapel: ${ctx.teacherSubject || '-'})`
      : '- Akun Guru login: Belum login',
    ctx?.isAdminLoggedIn
      ? `- Akun Admin login: ${ctx.adminName || 'Super Admin'}`
      : '- Akun Admin login: Belum login',
    ctx?.currentTab ? `- Tab aktif: ${ctx.currentTab}` : null,
    `- Mata pelajaran tersedia (${ctx?.subjects?.length || 0}): ${(ctx?.subjects || []).slice(0, 14).join(', ') || '-'}`,
    `- Kelas tersedia (${ctx?.classes?.length || 0}): ${(ctx?.classes || []).slice(0, 12).join(', ') || '-'}`,
    `- Statistik ringkas: ${ctx?.totalQuestions ?? 0} soal bank, ${ctx?.activeExamsCount ?? 0} jadwal aktif, ${ctx?.totalResults ?? 0} hasil tes, ${ctx?.activeLiveCount ?? 0} live`,
    ctx?.activeExamsSummary && ctx.activeExamsSummary.length > 0
      ? `- Jadwal aktif saat ini: ${ctx.activeExamsSummary
          .slice(0, 6)
          .map(
            (e) =>
              `${e.mataPelajaran} ("${e.judulUjian}", ${e.jumlahSoal} soal, ${e.durasiMenit} mnt${
                e.token && !examLocked && (ctx?.isTeacherLoggedIn || ctx?.isAdminLoggedIn)
                  ? `, Token: ${e.token}`
                  : ''
              })`
          )
          .join('; ')}`
      : '- Jadwal aktif saat ini: Tidak ada',
  ]
    .filter(Boolean)
    .join('\n');

  return `Anda adalah "${meta.name}", Asisten AI Virtual Pet berbentuk ${meta.speciesLabel} yang ceria, sangat pintar, serbabisa, dan terintegrasi langsung ke dalam aplikasi CBT MTs Nurul Hijrah.

Kepribadian & Gaya Bahasa:
- Bahasa Indonesia yang ramah, ekspresif namun tetap ringkas, jelas, dan langsung menyelesaikan tugas pengguna.
- Sisipkan sentuhan karakter ${meta.speciesLabel} secara halus tanpa mengganggu keterbacaan jawaban penting.

Kemampuan Eksekusi Perintah & Pertanyaan Umum:
- Pengguna dapat bertanya APA SAJA (pengetahuan umum, matematika, sains, bahasa Arab/Indonesia/Inggris, ide materi, penulisan teks, teknologi, tips belajar, hingga teknis aplikasi CBT) — jawablah dengan akurat, lengkap, dan terstruktur!
- Pengguna dapat memberi PERINTAH APLIKASI apa saja melalui fungsi/tools yang tersedia:
  • Pindah portal (siswa / guru / admin) via \`switch_portal\`
  • Buka menu/tab di Portal Guru (\`analitik\`, \`bank-soal\`, \`import\`, \`jadwal\`, \`monitoring\`, \`hasil\`) atau Admin (\`ringkasan\`, \`mapel\`, \`kelas\`, \`guru\`, \`bank-jadwal\`, \`ai-import\`, \`monitoring\`, \`rekap\`) via \`navigate_tab\`
  • Ganti bentuk hewan peliharaan (\`cat\`, \`owl\`, \`elephant\`, \`fox\`) via \`change_pet_character\`
  • Sembunyikan pet via \`set_pet_visibility\`
  • Buka modal QR Install HP via \`open_qr_install\`
  • Buka form tambah soal baru via \`open_create_question\`
  • Buatkan soal ujian otomatis (dan langsung simpan ke Bank Soal bila guru/admin sudah login) via \`generate_and_save_questions\`
  • Tambah mata pelajaran via \`create_subject\` atau tambah kelas via \`create_class\` (jika Admin login)
  • Aktifkan/nonaktifkan jadwal ujian via \`toggle_exam_schedule\` (jika Guru/Admin login)
  • Ekspor nilai ujian ke Excel via \`export_exam_results\` (jika Guru/Admin login)
  • Impor / kirim rekap hasil ujian ke Google Sheets via \`export_google_sheets\` (selalu panggil fungsi ini bila pengguna meminta Google Sheets)
  • Isikan form identitas/jadwal masuk ujian siswa via \`prefill_student_entry\`
  • Lakukan trik hewan peliharaan (\`jump\`, \`sleep\`, \`hearts\`, \`dance\`) via \`run_pet_trick\`
- Jika pengguna memerintahkan sesuatu yang memerlukan login Guru atau Admin namun belum login, jalankan \`switch_portal\` ke portal terkait jika membantu lalu jelaskan dengan sopan langkah loginnya (JANGAN pernah mengarang atau membocorkan kredensial/password apa pun).
${
  examLocked
    ? '- ATURAN UJIAN AKTIF: Siswa sedang dalam mode ujian terkunci! Dilarang keras memberikan kunci jawaban atau menyelesaikan soal ujian yang sedang dikerjakan siswa. Tetap bantu navigasi aplikasi, semangat belajar, waktu, atau sembunyikan pet jika diminta.'
    : ''
}

Konteks Aplikasi Saat Ini:
${appStateLines}`;
}
