import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  GoogleGenAI,
  Type,
  type FunctionDeclaration,
  type GenerateContentParameters,
  type Schema,
} from '@google/genai';
import {
  chunkHtmlForAi,
  extractBalancedJsonArray,
  normalizeAiQuestions,
  parseGeminiRetryDelayMs,
  stripHtmlBoilerplateForAi,
  tokenizeDataImages,
} from './src/utils/aiQuestionUtils.ts';
import type { ParsedQuestionDraft } from './src/utils/questionParser.ts';
import {
  buildPetSystemInstruction,
  isValidPetId,
  normalizePetActions,
  type PetAppContextSummary,
  type PetCharacterId,
  type PetClientAction,
} from './src/utils/virtualPetUtils.ts';
import { APP_VERSION } from './src/config/version.ts';
import { computeRuntimeVersionManifest } from './buildHash.ts';

export { APP_VERSION };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '25mb' }));

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const QUESTION_ARRAY_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      tipe: {
        type: Type.STRING,
        description: 'Salah satu dari: PG, PG_KOMPLEKS, BENAR_SALAH, ESAI',
      },
      pertanyaanHtml: {
        type: Type.STRING,
        description:
          'Badan soal lengkap dalam HTML bersih (pertahankan table, img, bold, italic, sub/sup)',
      },
      opsi: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Daftar teks opsi jawaban bersih tanpa awalan A./B./C.',
      },
      kunciJawaban: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          'Huruf kunci (misal ["A"] atau ["A","C"]), atau ["Benar"]/["Salah"], atau pedoman esai',
      },
      bobot: {
        type: Type.NUMBER,
        description: 'Bobot nilai soal (misal 10 untuk PG/BS, 15 PG Kompleks, 20 Esai)',
      },
      kesulitan: {
        type: Type.STRING,
        description: 'Tingkat kesulitan: Mudah, Sedang, atau Sulit',
      },
      pembahasan: {
        type: Type.STRING,
        description: 'Penjelasan singkat dan jelas mengapa kunci jawaban tersebut benar',
      },
    },
    required: ['tipe', 'pertanyaanHtml', 'opsi', 'kunciJawaban'],
  },
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const upper = rawMsg.toUpperCase();

  if (upper.includes('API_KEY_INVALID') || upper.includes('PERMISSION_DENIED') || upper.includes('403')) {
    return {
      status: 403,
      message:
        'API key Gemini tidak valid atau belum memiliki izin. Periksa GEMINI_API_KEY di panel Settings > Secrets.',
    };
  }
  if (upper.includes('PERDAY') || upper.includes('GENERATEREQUESTSPERDAY') || upper.includes('PER DAY')) {
    return {
      status: 429,
      message:
        'Kuota permintaan harian AI pada API key gratis telah tercapai. Gunakan "Ekstrak Instan (Parser Lokal)" untuk dokumen Word/teks, atau tingkatkan API key di Settings > Secrets.',
    };
  }
  if (upper.includes('RESOURCE_EXHAUSTED') || upper.includes('429')) {
    return {
      status: 429,
      message: 'Kuota permintaan AI sedang penuh sesaat. Tunggu beberapa detik lalu coba lagi.',
    };
  }
  if (upper.includes('TIMEOUT') || upper.includes('DEADLINE_EXCEEDED')) {
    return {
      status: 504,
      message:
        'Proses AI melebihi batas waktu karena dokumen terlalu padat/kompleks. Coba unggah sebagian halaman atau gunakan "Ekstrak Instan (Parser Lokal)".',
    };
  }
  if (upper.includes('UNAVAILABLE') || upper.includes('503') || upper.includes('HIGH DEMAND')) {
    return {
      status: 503,
      message:
        'Server AI Gemini sedang mengalami lonjakan trafik sementara. Silakan klik ulang dalam beberapa detik.',
    };
  }
  if (upper.includes('NOT_FOUND') || upper.includes('404')) {
    return {
      status: 502,
      message: 'Model AI yang diminta tidak tersedia. Hubungi administrator server.',
    };
  }
  return {
    status: 500,
    message: rawMsg || 'Gagal menghubungi layanan Gemini AI.',
  };
}

function runWithAbortTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`TIMEOUT: ${label} melebihi batas waktu ${ms}ms`));
    }, ms);
    fn(controller.signal).then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || '')).toUpperCase();
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('TIMEOUT') ||
    msg.includes('ABORT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('FETCH FAILED') ||
    msg.includes('INTERNAL')
  );
}

interface ResilienceCallOptions {
  contents: GenerateContentParameters['contents'];
  systemInstruction: string;
  jsonSchema?: Schema;
  tools?: GenerateContentParameters['config'] extends { tools?: infer T } ? T : unknown[];
}

const modelBackoffUntilMs: Record<string, number> = {};

// Lightweight in-memory TTL cache (30 min, max 150 entries) so repeated parses/queries use 0 API quota
const AI_CACHE_TTL_MS = 30 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = 150;
const aiResponseCache = new Map<string, { expiresAt: number; payload: unknown }>();

function makeAiCacheKey(namespace: string, data: unknown): string {
  return `${namespace}:${crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')}`;
}

function getCachedAiResponse<T>(key: string): T | null {
  const entry = aiResponseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    aiResponseCache.delete(key);
    return null;
  }
  return entry.payload as T;
}

function setCachedAiResponse(key: string, payload: unknown): void {
  if (aiResponseCache.size >= AI_CACHE_MAX_ENTRIES) {
    const oldestKey = aiResponseCache.keys().next().value;
    if (oldestKey) aiResponseCache.delete(oldestKey);
  }
  aiResponseCache.set(key, {
    expiresAt: Date.now() + AI_CACHE_TTL_MS,
    payload,
  });
}

/**
 * Calls Gemini using the high-throughput Free Tier model (`gemini-3.1-flash-lite`) as primary
 * to avoid daily 20-request ceilings on `gemini-4-hydrogen`, with AbortSignal timeouts and
 * secondary model fallback only if the primary free-tier model is transiently unavailable.
 */
async function callGeminiWithResilience(ai: GoogleGenAI, opts: ResilienceCallOptions) {
  const now = Date.now();
  const liteInBackoff = now < (modelBackoffUntilMs['gemini-3.1-flash-lite'] || 0);
  const hydrogenInBackoff = now < (modelBackoffUntilMs['gemini-4-hydrogen'] || 0);

  const litePlan = { model: 'gemini-3.1-flash-lite', retries: 1, timeoutMs: 55000 };
  const hydrogenPlan = { model: 'gemini-4-hydrogen', retries: 0, timeoutMs: 25000 };

  const modelPlans: Array<typeof litePlan> = [];
  if (!liteInBackoff) {
    modelPlans.push(litePlan);
    if (!hydrogenInBackoff) modelPlans.push(hydrogenPlan);
  } else if (!hydrogenInBackoff) {
    modelPlans.push(hydrogenPlan);
  } else {
    modelPlans.push({ ...litePlan, retries: 0 });
  }

  let lastErr: unknown = null;

  for (let pIdx = 0; pIdx < modelPlans.length; pIdx++) {
    const plan = modelPlans[pIdx];
    const hasNextModel = pIdx < modelPlans.length - 1;

    for (let attempt = 0; attempt <= plan.retries; attempt++) {
      try {
        const response = await runWithAbortTimeout(
          (abortSignal) => {
            const config: Record<string, unknown> = {
              systemInstruction: opts.systemInstruction,
              abortSignal,
            };
            if (opts.jsonSchema) {
              config.responseMimeType = 'application/json';
              config.responseSchema = opts.jsonSchema;
            }
            if (opts.tools && opts.tools.length > 0) {
              config.tools = opts.tools;
            }
            return ai.models.generateContent({
              model: plan.model,
              contents: opts.contents,
              config,
            });
          },
          plan.timeoutMs,
          plan.model
        );

        return { response, modelUsed: plan.model };
      } catch (err) {
        lastErr = err;
        if (!isRetryableGeminiError(err)) {
          throw err;
        }
        const errText = err instanceof Error ? err.message : String(err);
        const upperErr = errText.toUpperCase();
        const isQuotaExhausted =
          upperErr.includes('RESOURCE_EXHAUSTED') || upperErr.includes('429');

        if (isQuotaExhausted) {
          modelBackoffUntilMs[plan.model] = Date.now() + parseGeminiRetryDelayMs(err);
          if (hasNextModel) {
            console.info(`[Gemini] ${plan.model} kuota terbatas, beralih ke model cadangan.`);
            break;
          }
          if (attempt < plan.retries) {
            await sleep(1200);
            continue;
          }
          break;
        }

        if (attempt < plan.retries) {
          console.info(
            `[Gemini] ${plan.model} percobaan ${attempt + 1} gagal (${errText}), mencoba ulang...`
          );
          await sleep(600 * Math.pow(2, attempt));
        } else if (hasNextModel) {
          console.info(`[Gemini] ${plan.model} gagal (${errText}), beralih ke model cadangan.`);
        }
      }
    }
  }

  throw lastErr;
}

function computeVersionSnapshot(): {
  version: string;
  buildId: string;
  buildHash: string;
  schemaVersion: number;
  builtAt?: string;
} {
  return computeRuntimeVersionManifest(__dirname, process.env.NODE_ENV === 'production');
}

let lastBroadcastSnapshot = computeVersionSnapshot();
const versionSseClients = new Set<express.Response>();

function broadcastVersionChangeIfChanged() {
  const next = computeVersionSnapshot();
  if (
    next.version === lastBroadcastSnapshot.version &&
    next.buildHash === lastBroadcastSnapshot.buildHash
  ) {
    return;
  }
  lastBroadcastSnapshot = next;
  const payload = `event: version\ndata: ${JSON.stringify(next)}\n\n`;
  for (const client of versionSseClients) {
    try {
      client.write(payload);
    } catch {
      versionSseClients.delete(client);
    }
  }
}

let watchDebounceTimer: NodeJS.Timeout | null = null;
function scheduleVersionCheck(filename?: string | Buffer | null) {
  const name = filename ? String(filename) : '';
  if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) return;
  if (watchDebounceTimer) clearTimeout(watchDebounceTimer);
  watchDebounceTimer = setTimeout(() => {
    broadcastVersionChangeIfChanged();
  }, 250);
}

try {
  const srcDir = path.resolve(__dirname, 'src');
  if (fs.existsSync(srcDir)) {
    fs.watch(srcDir, { recursive: true }, (_ev, file) => scheduleVersionCheck(file));
  }
  for (const singleFile of ['index.html', 'server.ts', 'vite.config.ts']) {
    const full = path.resolve(__dirname, singleFile);
    if (fs.existsSync(full)) {
      fs.watch(full, () => scheduleVersionCheck(singleFile));
    }
  }
  const distDir = path.resolve(__dirname, 'dist');
  if (fs.existsSync(distDir)) {
    fs.watch(distDir, (_ev, file) => scheduleVersionCheck(file));
  }
} catch {
  // Some virtual filesystems do not support recursive fs.watch; /api/version polling remains active
}

function sendVersionManifest(_req: express.Request, res: express.Response) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  const snap = computeVersionSnapshot();
  lastBroadcastSnapshot = snap;
  res.json({
    version: snap.version,
    buildId: snap.buildId,
    buildHash: snap.buildHash,
    schemaVersion: snap.schemaVersion,
    builtAt: snap.builtAt,
    serverTime: new Date().toISOString(),
  });
}

// Fast standalone health & version manifest endpoints (no editor session required)
app.get('/api/health', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  const snap = computeVersionSnapshot();
  res.json({
    ok: true,
    status: 'ready',
    version: snap.version,
    buildHash: snap.buildHash,
    serverTime: new Date().toISOString(),
  });
});

app.get('/api/version', sendVersionManifest);
app.get('/version.json', sendVersionManifest);

app.get('/api/version-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const snap = computeVersionSnapshot();
  lastBroadcastSnapshot = snap;
  res.write(`event: version\ndata: ${JSON.stringify(snap)}\n\n`);

  versionSseClients.add(res);
  const keepalive = setInterval(() => {
    try {
      res.write(': keepalive\n\n');
    } catch {
      clearInterval(keepalive);
      versionSseClients.delete(res);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    versionSseClients.delete(res);
  });
});

// Server-side Smart AI Multimodal Question Parser (HTML/Word/PDF/Images + Chunking + Auto-Solve)
app.post('/api/gemini/parse-questions', async (req, res) => {
  try {
    const {
      content = '',
      images = [],
      mataPelajaran = 'Umum',
      autoSolveMissingKeys = true,
    } = req.body as {
      content?: string;
      images?: Array<{ mimeType: string; data: string }>;
      mataPelajaran?: string;
      autoSolveMissingKeys?: boolean;
    };

    const validImages = Array.isArray(images)
      ? images.filter(
          (img) =>
            img &&
            typeof img.mimeType === 'string' &&
            typeof img.data === 'string' &&
            img.data.length > 0
        )
      : [];

    if (!content.trim() && validImages.length === 0) {
      res.status(400).json({ error: 'Konten soal atau gambar tidak boleh kosong.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error:
          'GEMINI_API_KEY belum terkonfigurasi di Settings > Secrets. Anda dapat menggunakan "Ekstrak Instan (Parser Lokal)" untuk file teks/Word.',
      });
      return;
    }

    const { cleanedHtml, assets } = tokenizeDataImages(content);
    const compactHtml = stripHtmlBoilerplateForAi(cleanedHtml);

    const cacheKey = makeAiCacheKey('parse', {
      compactHtml,
      imageHashes: validImages.map((img) => `${img.mimeType}:${img.data.length}:${img.data.slice(0, 64)}`),
      mataPelajaran,
      autoSolveMissingKeys,
    });
    const cachedParse = getCachedAiResponse<{ questions: ParsedQuestionDraft[]; modelUsed: string; chunksProcessed: number }>(cacheKey);
    if (cachedParse) {
      res.json({ ...cachedParse, cached: true });
      return;
    }

    const chunks = compactHtml ? chunkHtmlForAi(compactHtml, 7500) : [];
    const systemInstruction =
      'Anda adalah pakar asesmen dan ekstraktor soal CBT madrasah MTs Nurul Hijrah yang sangat cerdas dan teliti. ' +
      'Selalu jaga keutuhan HTML tabel (<table>, <thead>, <tbody>, <tr>, <th>, <td>), tag gambar (<img src="__CBT_IMG_...">), pemformatan <b>/<strong>/<i>/<sub>/<sup>, serta aksara Arab atau simbol matematika. ' +
      'Pastikan opsi jawaban BERSIH tanpa huruf awalan A./B./C., deteksi tipe soal secara presisi (PG, PG_KOMPLEKS, BENAR_SALAH, ESAI), dan jangan pernah menggabungkan dua nomor soal berbeda.';

    const allExtracted: ParsedQuestionDraft[] = [];
    let primaryModelUsed = 'gemini-3.1-flash-lite';
    let partialWarning: string | undefined;
    const totalBatches = chunks.length + (validImages.length > 0 ? Math.ceil(validImages.length / 2) : 0);

    // 1. Parse text/HTML chunks if any
    if (chunks.length > 0) {
      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) await sleep(150);
        const chunkText = chunks[i];
        const promptText = `Ekstrak seluruh butir soal ujian madrasah (Mata Pelajaran: ${mataPelajaran}, Bagian ${i + 1} dari ${chunks.length}) dari konten sumber berikut.

Aturan wajib:
1. Pertahankan seluruh tag HTML tabel (<table>...</table>), gambar (<img src="__CBT_IMG_...">), bacaan stimulus, aksara Arab, serta <sub>/<sup> di dalam pertanyaanHtml! JANGAN ubah placeholder __CBT_IMG_N__.
2. Klasifikasikan tipe secara akurat:
   - "PG": Pilihan Ganda 1 jawaban benar (opsi A–D/E).
   - "PG_KOMPLEKS": Pilihan Ganda Kompleks dengan >1 jawaban benar.
   - "BENAR_SALAH": Soal pernyataan Benar / Salah (opsi ["Benar", "Salah"]).
   - "ESAI": Soal uraian / isian terbuka.
3. ${
          autoSolveMissingKeys
            ? 'Ekstrak kunci jawaban jika tertulis; JIKA dokumen tidak mencantumkan kunci jawaban, analisis soalnya secara cerdas dan isikan kunciJawaban paling akurat beserta pembahasan singkat (1 kalimat)!'
            : 'Ekstrak kunci jawaban sesuai teks sumber (default ["A"] jika PG tanpa kunci).'
        }
4. Isikan tingkat kesulitan ("Mudah" | "Sedang" | "Sulit") dan pembahasan 1 kalimat ringkas.

Konten Sumber:
${chunkText}`;

        try {
          const { response, modelUsed } = await callGeminiWithResilience(ai, {
            contents: promptText,
            systemInstruction,
            jsonSchema: QUESTION_ARRAY_SCHEMA,
          });
          primaryModelUsed = modelUsed;
          const parsedRaw = extractBalancedJsonArray(response.text ?? '[]');
          allExtracted.push(...normalizeAiQuestions(parsedRaw, assets));
        } catch (chunkErr) {
          if (allExtracted.length > 0) {
            partialWarning = `Sebagian dokumen berhenti di bagian ${i + 1}/${chunks.length}: ${formatGeminiErrorMessage(chunkErr).message}`;
            break;
          }
          throw chunkErr;
        }
      }
    }

    // 2. Parse multimodal Vision images (photo/screenshot/scanned PDF pages) in batches of 2 pages
    if (validImages.length > 0 && !partialWarning) {
      for (let i = 0; i < validImages.length; i += 2) {
        if (i > 0 || chunks.length > 0) await sleep(150);
        const batchImages = validImages.slice(i, i + 2);
        const imageParts = batchImages.map((img) => ({
          inlineData: {
            mimeType: img.mimeType,
            data: img.data,
          },
        }));
        const visionPrompt = {
          parts: [
            ...imageParts,
            {
              text: `Baca dan ekstrak seluruh butir soal ujian (Mata Pelajaran: ${mataPelajaran}) dari gambar / halaman dokumen terlampir secara lengkap dan presisi.
Aturan:
1. Jika terdapat tabel pada gambar, rekonstruksi menjadi tag HTML <table><thead>...<tbody>...</table> yang rapi di dalam pertanyaanHtml.
2. Pertahankan aksara Arab, rumus, pangkat (<sup>/<sub>), dan tanda baca secara akurat.
3. Pisahkan setiap nomor soal, bersihkan opsi dari prefix A./B./C., deteksi tipe (PG, PG_KOMPLEKS, BENAR_SALAH, ESAI).
4. ${
                autoSolveMissingKeys
                  ? 'Jika kunci jawaban tidak tertulis pada gambar, kerjakan soal secara teliti untuk mengisi kunciJawaban terbaik beserta pembahasan 1 kalimat dan tingkat kesulitan.'
                  : 'Ekstrak kunci jawaban jika tertera pada gambar.'
              }`,
            },
          ],
        };

        try {
          const { response, modelUsed } = await callGeminiWithResilience(ai, {
            contents: visionPrompt,
            systemInstruction,
            jsonSchema: QUESTION_ARRAY_SCHEMA,
          });
          primaryModelUsed = modelUsed;
          const parsedRaw = extractBalancedJsonArray(response.text ?? '[]');
          allExtracted.push(...normalizeAiQuestions(parsedRaw, assets));
        } catch (visionErr) {
          if (allExtracted.length > 0) {
            partialWarning = `Ekstraksi gambar berhenti di halaman ${i + 1}: ${formatGeminiErrorMessage(visionErr).message}`;
            break;
          }
          throw visionErr;
        }
      }
    }

    const responsePayload = {
      questions: allExtracted,
      modelUsed: primaryModelUsed,
      chunksProcessed: totalBatches,
      ...(partialWarning ? { warning: partialWarning } : {}),
    };
    if (!partialWarning && allExtracted.length > 0) {
      setCachedAiResponse(cacheKey, responsePayload);
    }
    res.json(responsePayload);
  } catch (err) {
    console.error('Gemini parse-questions error:', err instanceof Error ? err.message : err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

// Server-side AI Automatic Question Generator for Teachers & Super Admin
app.post('/api/gemini/generate-questions', async (req, res) => {
  try {
    const {
      topik,
      mataPelajaran = 'Umum',
      kelas = 'VIII',
      jumlah = 5,
      tipe = 'CAMPURAN',
      kesulitan = 'Campuran',
      sertakanTabel = true,
    } = req.body as {
      topik?: string;
      mataPelajaran?: string;
      kelas?: string;
      jumlah?: number;
      tipe?: string;
      kesulitan?: string;
      sertakanTabel?: boolean;
    };

    if (!topik || !topik.trim()) {
      res.status(400).json({ error: 'Topik, materi, atau teks bacaan tidak boleh kosong.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY belum terkonfigurasi di Settings > Secrets.',
      });
      return;
    }

    const count = Math.min(20, Math.max(1, Number(jumlah) || 5));
    const tipeInstruction =
      tipe === 'CAMPURAN'
        ? 'Campuran proporsional antara PG (Pilihan Ganda 4 opsi), PG_KOMPLEKS (lebih dari 1 jawaban benar), BENAR_SALAH, dan ESAI.'
        : `Semua soal bertipe "${tipe}".`;

    const promptText = `Buatlah tepat ${count} butir soal ujian CBT berkualitas tinggi untuk Madrasah Tsanawiyah (MTs Nurul Hijrah).

Spesifikasi:
- Mata Pelajaran: ${mataPelajaran}
- Sasaran Kelas: ${kelas}
- Topik / Kompetensi / Materi Sumber: ${topik.trim()}
- Distribusi Tipe Soal: ${tipeInstruction}
- Tingkat Kesulitan: ${kesulitan}
- Stimulus Tabel / Bacaan: ${
      sertakanTabel
        ? 'Sertakan minimal 1–2 soal berbasis stimulus teks bacaan kontekstual atau tabel HTML (<table>...</table>) yang relevan dan mendidik.'
        : 'Gunakan kalimat soal yang lugas dan jelas.'
    }

Aturan Penulisan Wajib:
1. Untuk Mata Pelajaran keagamaan/Arab (Al-Qur'an Hadis, Bahasa Arab, Akidah Akhlak, Fikih, SKI), sertakan kutipan ayat/hadis/istilah Arab berharakat yang benar jika relevan.
2. Opsi jawaban PG/PG_KOMPLEKS berisi 4 pilihan (atau 5 bila perlu) yang masuk akal, setara panjangnya, dan TIDAK mengandung awalan "A. ", "B. ", "C. ".
3. Pastikan kunciJawaban 100% akurat secara keilmuan: ["A"]..["D"] untuk PG, ["A","C"] untuk PG_KOMPLEKS, ["Benar"] atau ["Salah"] untuk BENAR_SALAH, dan rubrik jawaban lengkap untuk ESAI.
4. Sertakan pembahasan ringkas dan tingkat kesulitan ("Mudah", "Sedang", atau "Sulit") di setiap soal.`;

    const { response, modelUsed } = await callGeminiWithResilience(ai, {
      contents: promptText,
      systemInstruction:
        'Anda adalah tim penyusun soal asesmen AKMI/Madrasah profesional di Indonesia yang ahli menyusun soal kontekstual, HOTS, akurat secara konsep, dan rapi dalam format HTML CBT.',
      jsonSchema: QUESTION_ARRAY_SCHEMA,
    });

    const parsedRaw = extractBalancedJsonArray(response.text ?? '[]');
    const questions = normalizeAiQuestions(parsedRaw);

    res.json({ questions, modelUsed });
  } catch (err) {
    console.error('Gemini generate-questions error:', err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

// Server-side AI Question Enhancer (Verify/Auto-Solve Keys, Upgrade to HOTS, or Polish Formatting)
app.post('/api/gemini/enhance-questions', async (req, res) => {
  try {
    const {
      questions = [],
      action = 'solve_keys',
      mataPelajaran = 'Umum',
    } = req.body as {
      questions?: ParsedQuestionDraft[];
      action?: 'solve_keys' | 'upgrade_hots' | 'fix_formatting';
      mataPelajaran?: string;
    };

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: 'Tidak ada daftar soal untuk disempurnakan AI.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY belum terkonfigurasi di Settings > Secrets.',
      });
      return;
    }

    const enhanceCacheKey = makeAiCacheKey('enhance', { action, mataPelajaran, questions });
    const cachedEnhance = getCachedAiResponse<{ questions: ParsedQuestionDraft[]; modelUsed: string }>(enhanceCacheKey);
    if (cachedEnhance) {
      res.json({ ...cachedEnhance, cached: true });
      return;
    }

    const actionPromptMap = {
      solve_keys:
        'Periksa ulang kebenaran ilmiah setiap soal, perbaiki atau lengkapi kunciJawaban jika salah/kurang tepat, tentukan kesulitan (Mudah/Sedang/Sulit), dan tambahkan pembahasan singkat yang jelas. JANGAN mengubah makna atau gambar (<img src="__CBT_IMG_...">) pada soal.',
      upgrade_hots:
        'Tingkatkan kualitas soal-soal berikut menjadi soal berbasis penalaran / HOTS (Higher Order Thinking Skills) dengan stimulus kontekstual atau studi kasus madrasah yang menarik (boleh menambah tabel HTML jika memperkuat analisis), sambil tetap menjaga topik inti, gambar (<img src="__CBT_IMG_...">), tipe soal, kunciJawaban yang valid, dan pembahasan.',
      fix_formatting:
        'Rapikan ejaan EYD bahasa Indonesia, tanda baca, format HTML (<sub>/<sup>/<table>), bersihkan opsi dari prefix ganda, dan pastikan kunciJawaban konsisten dengan tipe soal tanpa menghilangkan gambar (<img src="__CBT_IMG_...">).',
    };

    const chunkSize = 12;
    const enhancedAll: ParsedQuestionDraft[] = [];
    let lastModelUsed = '';
    let partialWarning: string | undefined;

    for (let offset = 0; offset < questions.length; offset += chunkSize) {
      if (offset > 0) await sleep(150);
      const slice = questions.slice(offset, offset + chunkSize);
      const combinedAssets: Record<string, string> = {};
      let imgCounter = 0;
      const sanitizedForAi = slice.map((q, idx) => {
        const { cleanedHtml, assets } = tokenizeDataImages(q.pertanyaanHtml || '');
        let remappedHtml = stripHtmlBoilerplateForAi(cleanedHtml);
        for (const [oldTok, uri] of Object.entries(assets)) {
          const newTok = `__CBT_IMG_${imgCounter++}__`;
          combinedAssets[newTok] = uri;
          remappedHtml = remappedHtml.split(oldTok).join(newTok);
        }
        return {
          index: offset + idx + 1,
          tipe: q.tipe,
          pertanyaanHtml: remappedHtml,
          opsi: q.opsi,
          kunciJawaban: q.kunciJawaban,
          bobot: q.bobot,
        };
      });

      const promptText = `Mata Pelajaran: ${mataPelajaran}
Tugas Penyempurnaan AI: ${actionPromptMap[action] || actionPromptMap.solve_keys}

Daftar Soal Input (JSON):
${JSON.stringify(sanitizedForAi)}`;

      try {
        const { response, modelUsed } = await callGeminiWithResilience(ai, {
          contents: promptText,
          systemInstruction:
            'Anda adalah editor ahli bank soal CBT madrasah. Kembalikan seluruh soal dengan urutan yang sama dalam format JSON terstruktur, menjaga semua tag <img src="__CBT_IMG_..."> secara utuh.',
          jsonSchema: QUESTION_ARRAY_SCHEMA,
        });

        lastModelUsed = modelUsed;
        const parsedRaw = extractBalancedJsonArray(response.text ?? '[]');
        enhancedAll.push(...normalizeAiQuestions(parsedRaw, combinedAssets));
      } catch (batchErr) {
        if (enhancedAll.length > 0) {
          enhancedAll.push(...questions.slice(offset));
          partialWarning = `Sebagian soal disempurnakan hingga nomor ${offset}: ${formatGeminiErrorMessage(batchErr).message}`;
          break;
        }
        throw batchErr;
      }
    }

    const responsePayload = {
      questions: enhancedAll,
      modelUsed: lastModelUsed,
      ...(partialWarning ? { warning: partialWarning } : {}),
    };
    if (!partialWarning && enhancedAll.length > 0) {
      setCachedAiResponse(enhanceCacheKey, responsePayload);
    }
    res.json(responsePayload);
  } catch (err) {
    console.error('Gemini enhance-questions error:', err instanceof Error ? err.message : err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

// Server-side AI Essay Auto-Grading Assistant for Teachers & Super Admin
app.post('/api/gemini/suggest-essay-score', async (req, res) => {
  try {
    const { mataPelajaran = 'Umum', items = [] } = req.body as {
      mataPelajaran?: string;
      items?: Array<{
        questionHtml: string;
        rubric?: string;
        studentAnswer: string;
        bobot?: number;
      }>;
    };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Tidak ada jawaban esai untuk dinilai.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Layanan AI belum tersedia di server.',
      });
      return;
    }

    const cleanedItems = items.map((it, i) => ({
      nomor: i + 1,
      soal: stripHtmlBoilerplateForAi(it.questionHtml || '').replace(/<[^>]+>/g, ' ').trim(),
      pedomanKunci: it.rubric || '(Tidak ada pedoman tertulis, nilai berdasarkan ketepatan konsep)',
      jawabanSiswa: it.studentAnswer || '(Kosong / tidak dijawab)',
      bobot: it.bobot || 20,
    }));

    const cacheKey = makeAiCacheKey('essay-grade', { mataPelajaran, cleanedItems });
    const cached = getCachedAiResponse<{ suggestedPercent: number; reason: string }>(cacheKey);
    if (cached) {
      res.json({ ...cached, cached: true });
      return;
    }

    const { response } = await callGeminiWithResilience(ai, {
      contents: `Nilai jawaban esai siswa berikut untuk mata pelajaran ${mataPelajaran}.
Berikan skor persentase keseluruhan (0 sampai 100) yang adil, objektif, dan proporsional terhadap bobot masing-masing soal, serta alasan evaluasi ringkas (1–2 kalimat) untuk guru.

Data Jawaban Esai:
${JSON.stringify(cleanedItems)}`,
      systemInstruction:
        'Anda adalah guru madrasah senior yang objektif dan bijaksana dalam mengoreksi jawaban esai siswa.',
      jsonSchema: {
        type: Type.OBJECT,
        properties: {
          suggestedPercent: {
            type: Type.NUMBER,
            description: 'Skor persentase keseluruhan 0 sampai 100 (bilangan bulat)',
          },
          reason: {
            type: Type.STRING,
            description: 'Alasan evaluasi ringkas dalam 1–2 kalimat bahasa Indonesia',
          },
        },
        required: ['suggestedPercent', 'reason'],
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      suggestedPercent?: number;
      reason?: string;
    };
    const safePercent = Math.max(0, Math.min(100, Math.round(Number(parsed.suggestedPercent) || 0)));
    const resultPayload = {
      suggestedPercent: safePercent,
      reason: String(parsed.reason || 'Evaluasi disarankan berdasarkan kesesuaian dengan konsep inti soal.'),
    };
    setCachedAiResponse(cacheKey, resultPayload);
    res.json(resultPayload);
  } catch (err) {
    console.error('Gemini suggest-essay-score error:', err instanceof Error ? err.message : err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

// Server-side Interactive Teacher Guide Assistant using @google/genai (with resilience & cache)
app.post('/api/gemini/tutor', async (req, res) => {
  try {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
    };

    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Pertanyaan tidak boleh kosong.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'Layanan AI server sedang tidak aktif. Gunakan panduan langkah cepat bawaan.',
      });
      return;
    }

    const trimmedMsg = message.trim();
    const tutorCacheKey = makeAiCacheKey('tutor', { trimmedMsg });
    if (!history || history.length <= 2) {
      const cachedReply = getCachedAiResponse<{ reply: string }>(tutorCacheKey);
      if (cachedReply) {
        res.json({ ...cachedReply, cached: true });
        return;
      }
    }

    const contextPrompt = (history || [])
      .slice(-6)
      .map((h) => `${h.role === 'user' ? 'Guru' : 'Asisten'}: ${h.text}`)
      .join('\n');

    const { response } = await callGeminiWithResilience(ai, {
      contents: contextPrompt ? `${contextPrompt}\nGuru: ${trimmedMsg}` : trimmedMsg,
      systemInstruction: `Anda adalah "Asisten AI CBT MTs Nurul Hijrah", mentor yang sangat ramah, sabar, dan jelas untuk guru madrasah pemula.
Jawab pertanyaan seputar cara menggunakan aplikasi CBT MTs Nurul Hijrah:
1. Menu "Data Modul / Bank Soal": membuat soal Pilihan Ganda (A-E), Pilihan Ganda Kompleks (banyak jawaban benar), Benar/Salah, dan Esai, serta tombol merah "Kosongkan Bank Soal" yang aman karena jadwal tes menyimpan snapshot soal sendiri.
2. Menu "Import Soal AI": mendukung upload .docx (Word + tabel & gambar), .pdf (teks maupun scan foto), gambar/screenshot soal (.png/.jpg), copy-paste Word, serta generator soal otomatis dari topik dengan kunci jawaban & pembahasan AI.
3. Menu "Data Tes / Jadwal Ujian": pilih soal dari bank soal, tentukan kelas & durasi, aktifkan tes, lalu bagikan Token Ujian (6 karakter) kepada siswa.
4. Menu "Live Monitoring Ujian": pantau video & audio siswa secara langsung seperti Zoom (default bisu agar tidak tabrakan, klik Unmute untuk dengar satu siswa, Spotlight untuk perbesar, dan Kirim Peringatan untuk bunyikan alarm di layar siswa).
5. Menu "Hasil Tes & Koreksi Esai": lihat nilai PG otomatis, gunakan "Saran Nilai Esai AI" atau input manual nilai Esai, tinjau riwayat pelanggaran keluar aplikasi, dan ekspor ke Excel/PDF.
Gunakan bahasa Indonesia yang sopan, terstruktur dengan poin bernomor singkat, dan mudah diikuti guru pemula.`,
    });

    const reply = response.text || 'Maaf, tidak ada jawaban yang dihasilkan.';
    if (!history || history.length <= 2) {
      setCachedAiResponse(tutorCacheKey, { reply });
    }
    res.json({ reply });
  } catch (err) {
    console.error('Gemini tutor error:', err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

const PET_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'switch_portal',
    description: 'Pindahkan halaman pengguna ke portal siswa, guru, atau admin.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        role: {
          type: Type.STRING,
          description: 'Portal tujuan: siswa, guru, atau admin',
        },
      },
      required: ['role'],
    },
  },
  {
    name: 'navigate_tab',
    description:
      'Buka tab atau menu spesifik di Portal Guru (analitik, bank-soal, import, jadwal, monitoring, hasil) atau Portal Admin (ringkasan, mapel, kelas, guru, bank-jadwal, ai-import, monitoring, rekap).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tab: {
          type: Type.STRING,
          description: 'ID tab tujuan sesuai portal aktif',
        },
      },
      required: ['tab'],
    },
  },
  {
    name: 'change_pet_character',
    description:
      'Ubah bentuk hewan peliharaan virtual asisten menjadi Kucing (cat), Burung Hantu (owl), Gajah Mini (elephant), atau Rubah/Anjing (fox).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        pet: {
          type: Type.STRING,
          description: 'Salah satu dari: cat, owl, elephant, fox',
        },
      },
      required: ['pet'],
    },
  },
  {
    name: 'set_pet_visibility',
    description: 'Sembunyikan atau tampilkan asisten hewan peliharaan mengambang di layar.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        visible: {
          type: Type.BOOLEAN,
          description: 'false untuk menyembunyikan pet, true untuk menampilkan kembali',
        },
      },
      required: ['visible'],
    },
  },
  {
    name: 'open_qr_install',
    description: 'Buka jendela Kode QR untuk install aplikasi PWA di HP siswa atau guru.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'open_create_question',
    description: 'Buka formulir modal Tambah Soal Baru secara langsung di Data Modul / Bank Soal.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'export_exam_results',
    description: 'Ekspor rekap nilai ujian siswa ke file Excel (.xlsx) sekarang juga.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mataPelajaran: {
          type: Type.STRING,
          description: 'Opsional: filter nama mata pelajaran tertentu',
        },
      },
    },
  },
  {
    name: 'export_google_sheets',
    description: 'Buka jendela impor/sinkronisasi rekap nilai ujian siswa langsung ke Google Sheets.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mataPelajaran: {
          type: Type.STRING,
          description: 'Opsional: filter nama mata pelajaran tertentu',
        },
      },
    },
  },
  {
    name: 'create_subject',
    description: 'Tambahkan mata pelajaran baru ke sistem sekolah (khusus Admin yang sudah login).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama mata pelajaran baru' },
        kode: { type: Type.STRING, description: 'Kode singkat mapel, misal MTK atau BIN' },
      },
      required: ['nama', 'kode'],
    },
  },
  {
    name: 'create_class',
    description: 'Tambahkan rombongan belajar / kelas baru (khusus Admin yang sudah login).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        nama: { type: Type.STRING, description: 'Nama kelas, misal VII C atau IX Unggulan' },
        tingkat: { type: Type.STRING, description: 'Tingkat kelas, misal VII, VIII, atau IX' },
      },
      required: ['nama', 'tingkat'],
    },
  },
  {
    name: 'toggle_exam_schedule',
    description: 'Aktifkan atau nonaktifkan jadwal ujian berdasarkan nama mapel, judul ujian, atau token.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: 'Nama mapel, judul ujian, atau token' },
        aktif: { type: Type.BOOLEAN, description: 'true untuk membuka jadwal, false untuk menutup' },
      },
      required: ['query'],
    },
  },
  {
    name: 'prefill_student_entry',
    description: 'Bantu isikan kolom formulir masuk ujian siswa (nama, kelas, mata pelajaran, atau token).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        namaSiswa: { type: Type.STRING, description: 'Nama lengkap siswa' },
        kelas: { type: Type.STRING, description: 'Kelas siswa, misal VII, VIII, IX' },
        mataPelajaran: { type: Type.STRING, description: 'Mata pelajaran ujian' },
        token: { type: Type.STRING, description: 'Token ujian jika diberikan pengguna' },
      },
    },
  },
  {
    name: 'generate_and_save_questions',
    description:
      'Buatkan butir soal ujian CBT berkualitas secara otomatis berdasarkan topik & mata pelajaran, lalu simpan ke Bank Soal bila Guru/Admin sedang login.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        mataPelajaran: { type: Type.STRING, description: 'Nama mata pelajaran' },
        topik: { type: Type.STRING, description: 'Topik atau materi soal yang diminta' },
        jumlah: { type: Type.NUMBER, description: 'Jumlah butir soal (1 sampai 10)' },
        tipe: {
          type: Type.STRING,
          description: 'Tipe soal: PG, PG_KOMPLEKS, BENAR_SALAH, ESAI, atau CAMPURAN',
        },
        kesulitan: { type: Type.STRING, description: 'Mudah, Sedang, Sulit, atau Campuran' },
      },
      required: ['mataPelajaran', 'topik'],
    },
  },
  {
    name: 'run_pet_trick',
    description: 'Jalankan animasi lucu pada karakter hewan peliharaan (lompat senang, tidur, hujan hati/bintang, atau menari).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        trick: {
          type: Type.STRING,
          description: 'Salah satu dari: jump, sleep, hearts, dance',
        },
      },
      required: ['trick'],
    },
  },
];

// Universal AI Virtual Pet Assistant endpoint supporting free-form Q&A + live app command execution
app.post('/api/gemini/pet-assistant', async (req, res) => {
  try {
    const {
      message,
      history = [],
      petType = 'cat',
      appContext,
    } = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'model'; text: string }>;
      petType?: PetCharacterId;
      appContext?: Partial<PetAppContextSummary>;
    };

    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Pesan untuk asisten hewan tidak boleh kosong.' });
      return;
    }

    const ai = getGeminiClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY belum terkonfigurasi di Settings > Secrets.',
      });
      return;
    }

    const activePet: PetCharacterId = isValidPetId(petType) ? petType : 'cat';
    const systemInstruction = buildPetSystemInstruction(activePet, appContext);
    const trimmedMsg = message.trim();

    const conversationParts = [
      ...(Array.isArray(history) ? history.slice(-8) : []).map((h) => ({
        role: h.role === 'model' ? ('model' as const) : ('user' as const),
        parts: [{ text: String(h.text || '') }],
      })),
      { role: 'user' as const, parts: [{ text: trimmedMsg }] },
    ];

    const { response: turn1, modelUsed } = await callGeminiWithResilience(ai, {
      contents: conversationParts,
      systemInstruction,
      tools: [{ functionDeclarations: PET_FUNCTION_DECLARATIONS }],
    });

    const rawCalls = turn1.functionCalls || [];
    const clientActions: PetClientAction[] = normalizePetActions(
      rawCalls.map((fc) => ({
        name: fc.name,
        args: (fc.args || {}) as Record<string, unknown>,
      }))
    );

    const toolExecutionSummary: Array<{ id?: string; name: string; result: string }> = [];

    // Execute server-side question generation if AI invoked `generate_and_save_questions`
    for (const fc of rawCalls) {
      if (fc.name !== 'generate_and_save_questions') continue;
      if (appContext?.isExamLocked) {
        toolExecutionSummary.push({
          id: fc.id,
          name: fc.name,
          result: 'Ditolak karena siswa sedang berada di mode ujian aktif terkunci.',
        });
        continue;
      }
      const args = (fc.args || {}) as Record<string, unknown>;
      const targetSubject = String(
        args.mataPelajaran || appContext?.teacherSubject || appContext?.subjects?.[0] || 'Umum'
      ).trim();
      const topik = String(args.topik || trimmedMsg).trim();
      const jumlah = Math.min(10, Math.max(1, Number(args.jumlah) || 3));
      const tipe = String(args.tipe || 'PG').toUpperCase();
      const kesulitan = String(args.kesulitan || 'Sedang');

      const genPrompt = `Buatlah tepat ${jumlah} butir soal CBT MTs Nurul Hijrah.
Mata Pelajaran: ${targetSubject}
Topik: ${topik}
Tipe: ${tipe === 'CAMPURAN' ? 'Campuran PG, PG_KOMPLEKS, BENAR_SALAH, dan ESAI' : tipe}
Kesulitan: ${kesulitan}
Pastikan opsi bersih tanpa huruf A./B./C., kunciJawaban akurat, dan sertakan pembahasan ringkas.`;

      const { response: genRes } = await callGeminiWithResilience(ai, {
        contents: genPrompt,
        systemInstruction:
          'Anda adalah penyusun soal madrasah profesional. Hasilkan JSON array soal CBT berkualitas tinggi.',
        jsonSchema: QUESTION_ARRAY_SCHEMA,
      });

      const parsedRaw = extractBalancedJsonArray(genRes.text ?? '[]');
      const generated = normalizeAiQuestions(parsedRaw).map((q) => ({
        tipe: q.tipe,
        pertanyaanHtml: q.pertanyaanHtml,
        opsi: q.opsi,
        kunciJawaban: q.kunciJawaban,
        bobot: q.bobot || 10,
      }));

      if (generated.length > 0) {
        clientActions.push({
          type: 'save_generated_questions',
          mataPelajaran: targetSubject,
          questions: generated,
        });
        toolExecutionSummary.push({
          id: fc.id,
          name: fc.name,
          result: `Berhasil membuat ${generated.length} soal ${targetSubject} tentang "${topik}" dan mengirimnya ke aplikasi.`,
        });
      } else {
        toolExecutionSummary.push({
          id: fc.id,
          name: fc.name,
          result: 'Gagal memproduksi daftar soal dari topik tersebut.',
        });
      }
    }

    for (const fc of rawCalls) {
      if (!fc.name || fc.name === 'generate_and_save_questions') continue;
      toolExecutionSummary.push({
        id: fc.id,
        name: fc.name,
        result: `Perintah ${fc.name} telah diteruskan untuk dieksekusi di layar aplikasi.`,
      });
    }

    let replyText = (turn1.text || '').trim();

    const ranServerQuestionGen = rawCalls.some((fc) => fc.name === 'generate_and_save_questions');
    if (!replyText && rawCalls.length > 0) {
      if (ranServerQuestionGen) {
        const prevContent = turn1.candidates?.[0]?.content;
        if (prevContent) {
          try {
            const { response: turn2 } = await callGeminiWithResilience(ai, {
              contents: [
                ...conversationParts,
                prevContent,
                {
                  role: 'user',
                  parts: toolExecutionSummary.map((item) => ({
                    functionResponse: {
                      ...(item.id ? { id: item.id } : {}),
                      name: item.name,
                      response: { result: item.result },
                    },
                  })),
                },
              ],
              systemInstruction,
              tools: [{ functionDeclarations: PET_FUNCTION_DECLARATIONS }],
            });
            replyText = (turn2.text || '').trim();
          } catch {
            replyText = toolExecutionSummary.map((s) => s.result).join(' ');
          }
        }
      }
      if (!replyText) {
        replyText =
          clientActions.length > 0
            ? 'Siap! Perintahmu sudah langsung dijalankan di layar aplikasi.'
            : toolExecutionSummary.map((s) => s.result).join(' ');
      }
    }

    if (!replyText) {
      replyText =
        clientActions.length > 0
          ? 'Siap! Perintahmu sudah langsung dijalankan.'
          : 'Maaf, coba ulangi pertanyaan atau perintahmu dengan kalimat lain ya!';
    }

    res.json({
      reply: replyText,
      actions: clientActions,
      modelUsed,
    });
  } catch (err) {
    console.error('Gemini pet-assistant error:', err instanceof Error ? err.message : err);
    const { status, message } = formatGeminiErrorMessage(err);
    res.status(status).json({ error: message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    // Serve a clean no-WebSocket /@vite/client module when HMR is disabled so the browser
    // never attempts failing ws://...:24678 HMR connections behind proxies or iframes.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(`
const sheetsMap = new Map();
export class ErrorOverlay {}
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
`);
    });

    const vitePromise = createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    app.use((req, res, next) => {
      const p = req.path;
      if (p === '/manifest.webmanifest') {
        res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
      } else if (p === '/' || p === '/index.html') {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
      } else if (p === '/sw.js' || p === '/dev-sw.js' || p === '/version.json') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
      vitePromise
        .then((vite) => vite.middlewares(req, res, next))
        .catch(next);
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      const noStoreFiles = new Set(['/sw.js', '/registerSW.js', '/version.json']);
      const revalidateFiles = new Set(['/', '/index.html', '/manifest.webmanifest']);
      app.use(
        express.static(distPath, {
          setHeaders: (res, filePath) => {
            const rel = `/${path.relative(distPath, filePath).replace(/\\/g, '/')}`;
            if (rel === '/manifest.webmanifest') {
              res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            }
            if (noStoreFiles.has(rel)) {
              res.setHeader(
                'Cache-Control',
                'no-store, no-cache, must-revalidate, proxy-revalidate'
              );
              res.setHeader('Pragma', 'no-cache');
              res.setHeader('Expires', '0');
            } else if (revalidateFiles.has(rel) || rel.endsWith('.html')) {
              res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
            } else if (rel.startsWith('/assets/')) {
              res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
          },
        })
      );
      app.get('*', (req, res) => {
        if (
          req.path.startsWith('/assets/') ||
          /\.(js|mjs|css|map|woff2?|png|svg|ico)$/i.test(req.path)
        ) {
          res.setHeader('Cache-Control', 'no-store');
          res.status(404).end();
          return;
        }
        res.setHeader('Cache-Control', 'no-cache, must-revalidate, max-age=0');
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CBT MTs Nurul Hijrah server running on http://localhost:${PORT}`);
  });
}

startServer();
