import React, { useEffect, useRef, useState } from 'react';
import {
  UploadCloud,
  Sparkles,
  FileText,
  CheckCircle2,
  Trash2,
  Wand2,
  Image as ImageIcon,
  BrainCircuit,
  ShieldCheck,
  Zap,
  X,
  Plus,
  Loader2,
} from 'lucide-react';
import type { Question, QuestionType } from '../types/cbt';
import { parseRichHtmlQuestions, type ParsedQuestionDraft } from '../utils/questionParser';
import { getOptionLetter } from '../utils/examLogic';

import {
  chunkArray,
  chunkHtmlForAi,
  escapePlainTextForHtml,
  fetchJsonWithRetry,
  formatSpreadsheetRowsToHtml,
  hasMeaningfulHtmlContent,
  restoreDataImages,
  sanitizeHtmlImport,
  stripHtmlBoilerplateForAi,
  stripRtfToPlainText,
  tokenizeDataImages,
} from '../utils/aiQuestionUtils';
import { localVerifyAndFixDrafts } from '../utils/questionAnalysis';

interface SmartImportPanelProps {
  subjects: string[];
  selectedSubject: string;
  onChangeSubject: (subj: string) => void;
  lockedSubject?: string;
  teacherName: string;
  onSaveImportedQuestions: (items: Array<Omit<Question, 'id' | 'createdAt'>>) => Promise<unknown>;
  onSuccessRedirect?: () => void;
}

interface AttachedVisionImage {
  name: string;
  mimeType: string;
  data: string; // raw base64 without data: prefix
  previewUrl: string;
}

type StudioMode = 'extract' | 'generate';

function compressImageDataUrl(dataUrl: string, fallbackMime: string): Promise<{ mimeType: string; data: string; previewUrl: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1500;
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (width <= maxDim && height <= maxDim && dataUrl.length <= 450_000) {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        resolve({
          mimeType: match?.[1] || fallbackMime || 'image/jpeg',
          data: match?.[2] || '',
          previewUrl: dataUrl,
        });
        return;
      }
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        resolve({
          mimeType: match?.[1] || fallbackMime || 'image/jpeg',
          data: match?.[2] || '',
          previewUrl: dataUrl,
        });
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const jpegUrl = canvas.toDataURL('image/jpeg', 0.78);
      const base64 = jpegUrl.split(',')[1] || '';
      resolve({
        mimeType: 'image/jpeg',
        data: base64,
        previewUrl: jpegUrl,
      });
    };
    img.onerror = () => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      resolve({
        mimeType: match?.[1] || fallbackMime || 'image/png',
        data: match?.[2] || '',
        previewUrl: dataUrl,
      });
    };
    img.src = dataUrl;
  });
}

function fileToBase64Image(file: File): Promise<AttachedVisionImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        reject(new Error('Format gambar tidak valid.'));
        return;
      }
      const compressed = await compressImageDataUrl(dataUrl, match[1] || file.type || 'image/png');
      resolve({
        name: file.name,
        mimeType: compressed.mimeType,
        data: compressed.data,
        previewUrl: compressed.previewUrl,
      });
    };
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.readAsDataURL(file);
  });
}

async function compressHtmlEmbeddedImages(html: string): Promise<string> {
  if (!html || !html.includes('data:image/')) return html;
  const imgRegex = /(<img[^>]*?\ssrc=["'])(data:image\/[^"']+)(["'][^>]*>)/gi;
  const matches = Array.from(html.matchAll(imgRegex));
  if (matches.length === 0) return html;

  let updated = html;
  for (const m of matches) {
    const dataUri = m[2];
    if (dataUri.length <= 180_000) continue;
    try {
      const mimeMatch = dataUri.match(/^data:([^;]+);base64,/);
      const compressed = await compressImageDataUrl(dataUri, mimeMatch?.[1] || 'image/jpeg');
      if (compressed.previewUrl && compressed.previewUrl.length < dataUri.length) {
        updated = updated.split(dataUri).join(compressed.previewUrl);
      }
    } catch {
      // Keep original data URI if canvas fails
    }
  }
  return updated;
}

async function extractPdfContentWithVisionFallback(
  buffer: ArrayBuffer,
  baseName: string
): Promise<{ html: string; visionImages: AttachedVisionImage[] }> {
  const [pdfjsLib, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerModule.default;
  }
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  let combinedHtml = '';
  const visionImages: AttachedVisionImage[] = [];
  const maxPagesToRender = 16;

  const OPS = (pdfjsLib as { OPS?: Record<string, number> }).OPS || {};
  const imageOpCodes = new Set<number>(
    [
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintImageMaskXObject,
      OPS.paintFormXObjectBegin,
    ].filter((v): v is number => typeof v === 'number')
  );

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let currentLine = '';
    const pageLines: string[] = [];
    let lastY: number | null = null;

    for (const rawItem of content.items) {
      if (!('str' in rawItem)) continue;
      const item = rawItem as { str: string; hasEOL?: boolean; transform?: number[] };
      const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.trim()) {
        pageLines.push(currentLine.trim());
        currentLine = '';
      }

      currentLine += (currentLine && item.str ? ' ' : '') + item.str;
      if (item.hasEOL && currentLine.trim()) {
        pageLines.push(currentLine.trim());
        currentLine = '';
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) pageLines.push(currentLine.trim());

    const pagePlainText = pageLines.join(' ').trim();

    // Detect embedded images / diagrams on this PDF page so mixed text+figure exams also use Vision OCR
    let hasEmbeddedImages = false;
    try {
      const opList = await page.getOperatorList();
      if (Array.isArray(opList?.fnArray)) {
        hasEmbeddedImages = opList.fnArray.some((fn: number) => imageOpCodes.has(fn));
      }
    } catch {
      // Ignore operator list errors on protected PDFs
    }

    const shouldRenderForVision =
      visionImages.length < maxPagesToRender && (pagePlainText.length < 80 || hasEmbeddedImages);

    if (shouldRenderForVision) {
      const viewport = page.getViewport({ scale: 1.4 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas } as never).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1] || '';
        if (base64) {
          visionImages.push({
            name: `${baseName} (Hal. ${i})`,
            mimeType: 'image/jpeg',
            data: base64,
            previewUrl: dataUrl,
          });
          // Skip duplicating raw text if Vision is already reading the full rendered page cleanly
          continue;
        }
      }
    }

    if (pagePlainText) {
      combinedHtml += pageLines.map((l) => `<p>${escapePlainTextForHtml(l)}</p>`).join('\n') + '\n';
    }
  }

  return { html: combinedHtml, visionImages };
}

export const SmartImportPanel: React.FC<SmartImportPanelProps> = ({
  subjects,
  selectedSubject,
  onChangeSubject,
  lockedSubject,
  teacherName,
  onSaveImportedQuestions,
  onSuccessRedirect,
}) => {
  const validSelected = subjects.includes(selectedSubject)
    ? selectedSubject
    : subjects[0] || '';
  const activeSubject = lockedSubject || validSelected;
  const pasteEditorRef = useRef<HTMLDivElement | null>(null);

  const [studioMode, setStudioMode] = useState<StudioMode>('extract');
  const [rawHtmlContent, setRawHtmlContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedVisionImage[]>([]);
  const [autoSolveMissingKeys, setAutoSolveMissingKeys] = useState(true);

  // AI Generator state
  const [genTopik, setGenTopik] = useState('');
  const [genKelas, setGenKelas] = useState('VIII');
  const [genJumlah, setGenJumlah] = useState(5);
  const [genTipe, setGenTipe] = useState<'CAMPURAN' | QuestionType>('CAMPURAN');
  const [genKesulitan, setGenKesulitan] = useState<'Campuran' | 'Mudah' | 'Sedang' | 'Sulit'>('Campuran');
  const [genSertakanTabel, setGenSertakanTabel] = useState(true);

  const [isParsing, setIsParsing] = useState(false);
  const [aiProgressText, setAiProgressText] = useState<string | null>(null);
  const [enhancingAction, setEnhancingAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<ParsedQuestionDraft[]>([]);

  useEffect(() => {
    if (studioMode === 'extract' && pasteEditorRef.current && rawHtmlContent) {
      if (pasteEditorRef.current.innerHTML !== rawHtmlContent) {
        pasteEditorRef.current.innerHTML = rawHtmlContent;
      }
    }
  }, [studioMode, rawHtmlContent]);

  const handleFilesInput = async (files: FileList | File[]) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    const list = Array.from(files);
    if (list.length === 0) return;

    const imageExts = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'tiff', 'tif', 'heic']);
    const spreadsheetExts = new Set(['xlsx', 'xls', 'ods', 'csv', 'tsv']);

    try {
      let accumulatedHtml = rawHtmlContent && hasMeaningfulHtmlContent(rawHtmlContent) && list.length > 1 ? rawHtmlContent : '';

      for (const file of list) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (file.type.startsWith('image/') || imageExts.has(ext)) {
          const img = await fileToBase64Image(file);
          setAttachedImages((prev) => [...prev, img]);
          setFileName((prev) => (prev ? `${prev}, ${file.name}` : file.name));
        } else if (ext === 'docx') {
          setFileName(file.name);
          const [buffer, mammoth] = await Promise.all([file.arrayBuffer(), import('mammoth')]);
          const result = await mammoth.convertToHtml(
            { arrayBuffer: buffer },
            {
              convertImage: mammoth.images.imgElement((image) =>
                image.read('base64').then((imgBuffer) => ({
                  src: `data:${image.contentType};base64,${imgBuffer}`,
                }))
              ),
            }
          );
          accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${result.value}` : result.value;
        } else if (ext === 'pdf') {
          setFileName(file.name);
          const buffer = await file.arrayBuffer();
          const { html, visionImages } = await extractPdfContentWithVisionFallback(buffer, file.name);
          if (html.trim()) {
            accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${html}` : html;
          }
          if (visionImages.length > 0) {
            setAttachedImages((prev) => [...prev, ...visionImages]);
            setSuccessMsg(
              `PDF siap diekstrak (${visionImages.length} halaman visual/scan${html.trim() ? ' + teks' : ''}). Klik "Ekstrak dengan Smart AI (Vision & Auto-Kunci)".`
            );
          }
        } else if (spreadsheetExts.has(ext)) {
          setFileName(file.name);
          const [buffer, XLSX] = await Promise.all([file.arrayBuffer(), import('xlsx')]);
          const wb = XLSX.read(buffer, { type: 'array' });
          const sheetBlocks = wb.SheetNames.map((name) => {
            const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1 });
            return formatSpreadsheetRowsToHtml(rows, wb.SheetNames.length > 1 ? name : undefined);
          }).filter(Boolean);
          const joined = sheetBlocks.join('\n');
          accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${joined}` : joined;
        } else if (ext === 'html' || ext === 'htm') {
          setFileName(file.name);
          const cleaned = sanitizeHtmlImport(await file.text());
          accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${cleaned}` : cleaned;
        } else if (ext === 'rtf') {
          setFileName(file.name);
          const plain = stripRtfToPlainText(await file.text());
          const htmlText = plain
            .split(/\r?\n/)
            .map((l) => (l.trim() ? `<p>${escapePlainTextForHtml(l)}</p>` : ''))
            .filter(Boolean)
            .join('\n');
          accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${htmlText}` : htmlText;
        } else {
          setFileName(file.name);
          const text = await file.text();
          const htmlText = text
            .split(/\r?\n/)
            .map((l) => (l.trim() ? `<p>${escapePlainTextForHtml(l)}</p>` : ''))
            .filter(Boolean)
            .join('\n');
          accumulatedHtml = accumulatedHtml ? `${accumulatedHtml}\n${htmlText}` : htmlText;
        }
      }

      if (accumulatedHtml) {
        setRawHtmlContent(accumulatedHtml);
        if (pasteEditorRef.current) pasteEditorRef.current.innerHTML = accumulatedHtml;
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? `Gagal membaca file: ${err.message}` : 'Gagal mengekstrak dokumen.'
      );
    }
  };

  const handlePasteImages = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => Boolean(f));

    const plainClip = e.clipboardData?.getData('text/plain')?.trim() || '';
    if (imageFiles.length > 0 && plainClip.length < 20) {
      e.preventDefault();
      for (const f of imageFiles) {
        const img = await fileToBase64Image(f);
        setAttachedImages((prev) => [...prev, img]);
      }
    }
  };

  const tryRunLocalSmartParse = (content: string): ParsedQuestionDraft[] => {
    if (!content.trim()) return [];
    const extracted = parseRichHtmlQuestions(content);
    if (extracted.length === 0) return [];
    const { drafts: verified } = localVerifyAndFixDrafts(extracted);
    return verified;
  };

  const restoreAssetsOnDrafts = (
    items: ParsedQuestionDraft[],
    assets: Record<string, string>
  ): ParsedQuestionDraft[] => {
    if (Object.keys(assets).length === 0) return items;
    return items.map((d) => ({
      ...d,
      pertanyaanHtml: restoreDataImages(d.pertanyaanHtml, assets),
      opsi: Array.isArray(d.opsi) ? d.opsi.map((o) => restoreDataImages(o, assets)) : [],
    }));
  };

  const handleAIParse = async () => {
    const content = pasteEditorRef.current?.innerHTML ?? rawHtmlContent;
    const hasTextOrHtml = hasMeaningfulHtmlContent(content);
    if (!hasTextOrHtml && attachedImages.length === 0) {
      setErrorMsg('Tempel soal (format apa pun), unggah dokumen (.docx/.pdf/.xlsx/.txt/.html), atau lampirkan foto soal terlebih dahulu.');
      return;
    }
    setIsParsing(true);
    setAiProgressText('Menyiapkan dokumen untuk Smart AI (Gratis)...');
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      // Tokenize embedded base64 images & strip Word XML bloat BEFORE chunking so payloads stay lightweight
      const { cleanedHtml, assets: clientAssets } = hasTextOrHtml
        ? tokenizeDataImages(content)
        : { cleanedHtml: '', assets: {} as Record<string, string> };
      const compactHtml = hasTextOrHtml ? stripHtmlBoilerplateForAi(cleanedHtml) : '';
      // Keep text chunks compact (~3,800 chars) and Vision requests 1 image per call so every API turn finishes rapidly (<10s) without proxy timeouts
      const textChunks = compactHtml ? chunkHtmlForAi(compactHtml, 3800) : [];
      const queue: Array<{ content: string; images: Array<{ mimeType: string; data: string }> }> = [];

      for (const tc of textChunks) {
        queue.push({ content: tc, images: [] });
      }
      for (const img of attachedImages) {
        queue.push({
          content: '',
          images: [{ mimeType: img.mimeType, data: img.data }],
        });
      }
      if (queue.length === 0) {
        queue.push({ content: compactHtml, images: [] });
      }

      const collected: ParsedQuestionDraft[] = [];
      let partialWarn: string | null = null;
      let lastModel = 'gemini-3.1-flash-lite';
      let stepIndex = 0;

      while (stepIndex < queue.length) {
        const reqItem = queue[stepIndex];
        setAiProgressText(
          queue.length > 1
            ? `Smart AI mengekstrak bagian ${stepIndex + 1} dari ${queue.length}...`
            : 'Smart AI sedang mengekstrak & menyusun kunci jawaban...'
        );

        const result = await fetchJsonWithRetry<{
          questions?: ParsedQuestionDraft[];
          modelUsed?: string;
          error?: string;
          warning?: string;
        }>({
          url: '/api/gemini/parse-questions',
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: reqItem.content,
              images: reqItem.images,
              mataPelajaran: activeSubject,
              autoSolveMissingKeys,
            }),
          },
          timeoutMs: 32_000,
          maxRetries: 2,
          baseDelayMs: 700,
          onRetry: (attempt) => {
            setAiProgressText(
              `Menyambung ulang bagian ${stepIndex + 1}/${queue.length} (percobaan ${attempt + 1})...`
            );
          },
        });

        // Adaptive self-healing: if a large text chunk still timed out or was too large, split it in half and retry cleanly
        if (
          !result.ok &&
          (result.wasTimeoutOrNetwork || result.wasPayloadTooLarge) &&
          reqItem.images.length === 0 &&
          reqItem.content.length > 1400
        ) {
          const splitHalves = chunkHtmlForAi(reqItem.content, Math.floor(reqItem.content.length / 2));
          if (splitHalves.length > 1) {
            queue.splice(
              stepIndex,
              1,
              ...splitHalves.map((part) => ({ content: part, images: [] }))
            );
            continue;
          }
        }

        if (!result.ok) {
          const msg = result.errorMessage || 'Gagal mengekstrak bagian soal melalui Smart AI.';
          if (collected.length > 0) {
            partialWarn = `Sebagian selesai (${collected.length} soal). Bagian ${stepIndex + 1} terhenti: ${msg}`;
            break;
          }
          setErrorMsg(msg);
          return;
        }

        const data = result.data;
        if (data?.modelUsed) lastModel = data.modelUsed;
        if (data?.questions && data.questions.length > 0) {
          const restored = restoreAssetsOnDrafts(data.questions, clientAssets);
          collected.push(...restored);
          setDrafts([...collected]);
        }
        if (data?.warning) {
          partialWarn = data.warning;
        }
        stepIndex += 1;
      }

      if (collected.length > 0) {
        setDrafts(collected);
        setSuccessMsg(
          `Smart AI (${lastModel} · Gratis) berhasil mengekstrak ${collected.length} butir soal lengkap dengan kunci & pembahasan.`
        );
        if (partialWarn) {
          setErrorMsg(partialWarn);
        }
      } else {
        setErrorMsg('Smart AI tidak menemukan butir soal yang terbaca pada dokumen atau gambar tersebut. Pastikan teks/gambar cukup jelas.');
      }
    } finally {
      setIsParsing(false);
      setAiProgressText(null);
    }
  };

  const handleAIGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genTopik.trim()) {
      setErrorMsg('Isi topik, kompetensi, atau teks bacaan materi terlebih dahulu.');
      return;
    }
    setIsParsing(true);
    setAiProgressText('Menyusun butir soal dengan Gemini Free Tier...');
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const result = await fetchJsonWithRetry<{
        questions?: ParsedQuestionDraft[];
        modelUsed?: string;
        error?: string;
      }>({
        url: '/api/gemini/generate-questions',
        init: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topik: genTopik,
            mataPelajaran: activeSubject,
            kelas: genKelas,
            jumlah: genJumlah,
            tipe: genTipe,
            kesulitan: genKesulitan,
            sertakanTabel: genSertakanTabel,
          }),
        },
        timeoutMs: 36_000,
        maxRetries: 2,
        baseDelayMs: 700,
      });

      if (!result.ok) {
        setErrorMsg(result.errorMessage || 'Gagal membuat soal dengan Smart AI.');
      } else if (result.data?.questions && result.data.questions.length > 0) {
        setDrafts((prev) => [...prev, ...result.data!.questions!]);
        setSuccessMsg(
          `Smart AI (${result.data.modelUsed || 'gemini-3.1-flash-lite'} · Gratis) berhasil membuat ${result.data.questions.length} soal baru untuk ${activeSubject} Kelas ${genKelas}.`
        );
      } else {
        setErrorMsg('AI tidak mengembalikan soal. Coba deskripsikan topik lebih spesifik.');
      }
    } finally {
      setIsParsing(false);
      setAiProgressText(null);
    }
  };

  const handleAIEnhance = async (action: 'solve_keys' | 'upgrade_hots' | 'fix_formatting') => {
    if (drafts.length === 0) return;
    setEnhancingAction(action);
    setAiProgressText(null);
    setErrorMsg(null);
    setSuccessMsg(null);

    const batches = chunkArray(drafts, 6);
    const enhancedCollected: ParsedQuestionDraft[] = [];
    let partialWarn: string | null = null;
    let lastModel = 'gemini-3.1-flash-lite';

    try {
      for (let b = 0; b < batches.length; b++) {
        if (batches.length > 1) {
          setAiProgressText(`Menganalisis kelompok ${b + 1} dari ${batches.length}...`);
        }
        const batchAssets: Record<string, string> = {};
        let imgSeq = 0;
        const compactBatch = batches[b].map((q) => {
          const { cleanedHtml, assets } = tokenizeDataImages(q.pertanyaanHtml || '');
          let strippedHtml = stripHtmlBoilerplateForAi(cleanedHtml);
          for (const [oldTok, uri] of Object.entries(assets)) {
            const sharedTok = `__CBT_IMG_${imgSeq++}__`;
            batchAssets[sharedTok] = uri;
            strippedHtml = strippedHtml.split(oldTok).join(sharedTok);
          }
          return { ...q, pertanyaanHtml: strippedHtml };
        });

        const result = await fetchJsonWithRetry<{
          questions?: ParsedQuestionDraft[];
          modelUsed?: string;
          error?: string;
          warning?: string;
        }>({
          url: '/api/gemini/enhance-questions',
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              questions: compactBatch,
              action,
              mataPelajaran: activeSubject,
            }),
          },
          timeoutMs: 32_000,
          maxRetries: 2,
          baseDelayMs: 700,
        });

        if (!result.ok) {
          const msg = result.errorMessage || 'Gagal menyempurnakan soal melalui Smart AI.';
          if (enhancedCollected.length > 0) {
            for (let r = b; r < batches.length; r++) enhancedCollected.push(...batches[r]);
            partialWarn = `Sebagian soal selesai disempurnakan. Kelompok ${b + 1} terhenti: ${msg}`;
            break;
          }
          setErrorMsg(msg);
          return;
        }
        const data = result.data;
        if (data?.modelUsed) lastModel = data.modelUsed;
        if (data?.questions && data.questions.length > 0) {
          enhancedCollected.push(...restoreAssetsOnDrafts(data.questions, batchAssets));
        } else {
          enhancedCollected.push(...batches[b]);
        }
        if (data?.warning) partialWarn = data.warning;
      }

      if (enhancedCollected.length > 0) {
        setDrafts(enhancedCollected);
        const label =
          action === 'upgrade_hots'
            ? 'meningkatkan soal ke level HOTS'
            : action === 'fix_formatting'
              ? 'merapikan ejaan & format soal'
              : 'memverifikasi kunci jawaban & pembahasan';
        setSuccessMsg(
          `Smart AI (${lastModel} · Gratis) berhasil ${label} untuk ${enhancedCollected.length} soal.`
        );
        if (partialWarn) setErrorMsg(partialWarn);
      }
    } finally {
      setEnhancingAction(null);
      setAiProgressText(null);
    }
  };

  const handleLocalAnalyzeDrafts = () => {
    if (drafts.length === 0) return;
    setErrorMsg(null);
    const { drafts: verified, summary } = localVerifyAndFixDrafts(drafts);
    setDrafts(verified);
    setSuccessMsg(summary);
  };

  const handleLocalParse = () => {
    const content = pasteEditorRef.current?.innerHTML || rawHtmlContent;
    if (!content.trim()) {
      setErrorMsg('Tempel soal dari Word atau unggah file dokumen teks/Word terlebih dahulu.');
      return;
    }
    setErrorMsg(null);
    const verified = tryRunLocalSmartParse(content);
    if (verified.length === 0) {
      setErrorMsg('Pastikan soal memiliki penomoran (seperti 1., 2., 3. atau list Word) agar dapat dipisahkan otomatis.');
      return;
    }
    setDrafts(verified);
    setSuccessMsg(
      `Deteksi Cerdas Lokal (Gratis Tanpa Limit) berhasil mengekstrak ${verified.length} butir soal lengkap dengan kunci, level kognitif, tabel & gambar utuh.`
    );
  };

  const handleSaveAllDrafts = async () => {
    if (drafts.length === 0 || isSaving) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const preparedQuestions: Array<Omit<Question, 'id' | 'createdAt'>> = [];
      for (const d of drafts) {
        const compressedHtml = await compressHtmlEmbeddedImages(d.pertanyaanHtml);
        const compressedOpsi: string[] = [];
        for (const opt of d.opsi) {
          compressedOpsi.push(await compressHtmlEmbeddedImages(opt));
        }
        preparedQuestions.push({
          mataPelajaran: activeSubject,
          tipe: d.tipe,
          pertanyaanHtml: compressedHtml,
          opsi: compressedOpsi,
          kunciJawaban: d.kunciJawaban,
          bobot: d.bobot || (d.tipe === 'ESAI' ? 20 : 10),
          createdBy: teacherName,
        });
      }

      const saveResult = (await onSaveImportedQuestions(preparedQuestions)) as
        | { syncedToCloud?: boolean; queued?: boolean; errorMessage?: string }
        | undefined;

      const countSaved = drafts.length;
      setDrafts([]);
      setRawHtmlContent('');
      setAttachedImages([]);
      setFileName(null);
      if (pasteEditorRef.current) pasteEditorRef.current.innerHTML = '';

      if (saveResult && saveResult.syncedToCloud === false) {
        setSuccessMsg(
          `${countSaved} butir soal disimpan & masuk antrean sinkronisasi server (${activeSubject}).`
        );
      } else {
        setSuccessMsg(
          `Berhasil menyimpan & menyinkronkan ${countSaved} butir soal ke Bank Soal ${activeSubject}!`
        );
      }
      onSuccessRedirect?.();
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Gagal menyimpan soal ke server database.';
      setErrorMsg(
        `Soal belum masuk ke server: ${msg}. Draf Anda tetap aman di layar untuk diperiksa.`
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-5 panel-enter">
      <div className="surface-card p-5 space-y-4">
        {/* Header & Segmented Studio Mode Switch */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-bold text-slate-900">
                Studio Soal AI Terintegrasi
              </h3>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 border border-emerald-200">
                <BrainCircuit className="h-3 w-3" />
                <span>AI Vision &amp; Smart Generator</span>
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Ekstrak soal dari Word/PDF/Foto (tabel, gambar &amp; aksara Arab utuh) atau buat soal otomatis dari topik kurikulum.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {!lockedSubject && (
              <select
                value={activeSubject}
                onChange={(e) => onChangeSubject(e.target.value)}
                aria-label="Pilih Mata Pelajaran Import"
                className="glass-input rounded-xl px-3 py-2 text-xs font-semibold text-slate-800"
              >
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            <div className="glass-subtle inline-flex max-w-full overflow-x-auto rounded-2xl p-1">
              <button
                type="button"
                onClick={() => setStudioMode('extract')}
                className={`btn-press inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  studioMode === 'extract'
                    ? 'bg-white/85 text-emerald-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                }`}
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>Import Dokumen / Foto</span>
              </button>
              <button
                type="button"
                onClick={() => setStudioMode('generate')}
                className={`btn-press inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  studioMode === 'generate'
                    ? 'bg-white/85 text-emerald-800 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Buat Soal Otomatis AI</span>
              </button>
            </div>
          </div>
        </div>

        {/* MODE 1: EXTRACT FROM WORD / PDF / IMAGE / PASTE */}
        {studioMode === 'extract' && (
          <div className="space-y-4">
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files?.length) {
                  handleFilesInput(e.dataTransfer.files);
                }
              }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 backdrop-blur-sm p-6 text-center transition-colors hover:bg-emerald-500/15"
            >
              <UploadCloud className="h-8 w-8 text-emerald-700" />
              <p className="mt-2 text-sm font-semibold text-slate-900">
                Klik untuk pilih file atau tarik dokumen / foto soal ke sini
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Mendukung format apa pun: <strong>.docx</strong> (Word), <strong>.pdf</strong> (teks/scan), <strong>.xlsx/.xls/.csv</strong>, <strong>.html/.rtf/.md/.txt/.json</strong>, dan <strong>foto/screenshot</strong>
              </p>
              {fileName && (
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl bg-white/80 px-3 py-1 text-xs font-medium text-emerald-800 border border-emerald-300/60 max-w-full">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate max-w-[220px] sm:max-w-md">{fileName}</span>
                </span>
              )}
              <input
                type="file"
                multiple
                accept=".docx,.pdf,.xlsx,.xls,.ods,.csv,.tsv,.txt,.md,.html,.htm,.rtf,.json,.xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.svg,.avif,image/*"
                className="hidden"
                onChange={(e) => {
                  const picked = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (picked.length > 0) handleFilesInput(picked);
                }}
              />
            </label>

            {/* Attached Vision Images Strip */}
            {attachedImages.length > 0 && (
              <div className="glass-subtle rounded-2xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
                    <ImageIcon className="h-3.5 w-3.5 text-emerald-700" />
                    <span>{attachedImages.length} Gambar/Halaman Scan Siap Dibaca AI Vision</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAttachedImages([])}
                    className="text-red-600 hover:underline font-medium"
                  >
                    Hapus Semua Gambar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="relative group rounded-xl border border-white/65 bg-white/60 p-1"
                    >
                      <img
                        src={img.previewUrl}
                        alt={img.name}
                        className="h-16 w-20 rounded-lg object-cover"
                      />
                      <button
                        type="button"
                        aria-label={`Hapus gambar ${img.name}`}
                        onClick={() =>
                          setAttachedImages((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="btn-press absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-white shadow hover:bg-red-600"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rich Paste Area */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Area Paste Rich-Text dari Microsoft Word / Screenshot (Ctrl+V)
              </label>
              <div
                ref={pasteEditorRef}
                contentEditable
                onPaste={handlePasteImages}
                onInput={(e) => setRawHtmlContent(e.currentTarget.innerHTML)}
                data-placeholder="Tempel soal dari Microsoft Word, web, atau screenshot di sini (Ctrl+V)..."
                className="rich-question-content glass-input min-h-[150px] max-h-[320px] overflow-y-auto rounded-2xl p-3.5 text-sm text-slate-900"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSolveMissingKeys}
                onChange={(e) => setAutoSolveMissingKeys(e.target.checked)}
                className="h-4 w-4 rounded accent-emerald-700"
              />
              <span>
                <strong>Auto-isi Kunci Jawaban &amp; Pembahasan AI</strong> jika dokumen sumber belum memiliki kunci jawaban
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="button"
                disabled={isParsing}
                onClick={handleAIParse}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60 shadow-sm"
              >
                {isParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>
                  {isParsing
                    ? aiProgressText || 'AI Sedang Mengekstrak & Menganalisis...'
                    : 'Ekstrak dengan Smart AI (Vision & Auto-Kunci)'}
                </span>
              </button>

              <button
                type="button"
                disabled={isParsing}
                onClick={handleLocalParse}
                className="btn-press inline-flex items-center gap-2 rounded-xl border border-white/65 bg-white/60 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-white/85"
              >
                <Wand2 className="h-4 w-4 text-emerald-700" />
                <span>Deteksi Cerdas Lokal (Gratis Tanpa Limit)</span>
              </button>
            </div>
          </div>
        )}

        {/* MODE 2: AI AUTOMATIC QUESTION GENERATOR */}
        {studioMode === 'generate' && (
          <form onSubmit={handleAIGenerate} className="space-y-4">
            <div>
              <label
                htmlFor="ai-gen-topic"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Topik, Materi Pokok, Capaian Pembelajaran, atau Teks Bacaan Stimulus
              </label>
              <textarea
                id="ai-gen-topic"
                rows={4}
                value={genTopik}
                onChange={(e) => setGenTopik(e.target.value)}
                placeholder="Contoh: Hukum Bacaan Mad Thabi'i dan Mad Far'i pada Surah Al-Baqarah beserta contoh penerapannya (atau tempel teks bacaan panjang untuk dijadikan soal AKMI)."
                className="glass-input w-full rounded-2xl p-3.5 text-sm text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tingkat Kelas
                </label>
                <select
                  value={genKelas}
                  onChange={(e) => setGenKelas(e.target.value)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="VII">Kelas VII</option>
                  <option value="VIII">Kelas VIII</option>
                  <option value="IX">Kelas IX</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Jumlah Soal
                </label>
                <select
                  value={genJumlah}
                  onChange={(e) => setGenJumlah(Number(e.target.value))}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-semibold font-mono-tabular text-slate-900"
                >
                  <option value={3}>3 Soal</option>
                  <option value={5}>5 Soal</option>
                  <option value={10}>10 Soal</option>
                  <option value={15}>15 Soal</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Format Soal
                </label>
                <select
                  value={genTipe}
                  onChange={(e) => setGenTipe(e.target.value as 'CAMPURAN' | QuestionType)}
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="CAMPURAN">Campuran (PG, Kompleks, B/S, Esai)</option>
                  <option value="PG">Pilihan Ganda (PG)</option>
                  <option value="PG_KOMPLEKS">PG Kompleks</option>
                  <option value="BENAR_SALAH">Benar / Salah</option>
                  <option value="ESAI">Esai / Uraian</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Tingkat Kesulitan
                </label>
                <select
                  value={genKesulitan}
                  onChange={(e) =>
                    setGenKesulitan(
                      e.target.value as 'Campuran' | 'Mudah' | 'Sedang' | 'Sulit'
                    )
                  }
                  className="glass-input w-full rounded-xl px-3 py-2 text-xs font-semibold text-slate-900"
                >
                  <option value="Campuran">Berjenjang (Campuran)</option>
                  <option value="Mudah">Mudah (LOTS)</option>
                  <option value="Sedang">Sedang (Aplikasi)</option>
                  <option value="Sulit">Sulit (HOTS / Penalaran)</option>
                </select>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={genSertakanTabel}
                onChange={(e) => setGenSertakanTabel(e.target.checked)}
                className="h-4 w-4 rounded accent-emerald-700"
              />
              <span>Sertakan soal berbasis tabel data / bacaan kontekstual AKMI</span>
            </label>

            <div>
              <button
                type="submit"
                disabled={isParsing}
                className="btn-press inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {isParsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                )}
                <span>
                  {isParsing ? 'AI Sedang Menyusun Soal...' : 'Generate Soal Sekarang'}
                </span>
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
            <span>{errorMsg}</span>
            {studioMode === 'extract' && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={handleAIParse}
                  className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Coba Lagi Smart AI (Gratis)</span>
                </button>
                {hasMeaningfulHtmlContent(pasteEditorRef.current?.innerHTML ?? rawHtmlContent) && (
                  <button
                    type="button"
                    onClick={handleLocalParse}
                    className="btn-press inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100/60"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    <span>Gunakan Parser Lokal</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {successMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}
      </div>

      {/* Preview & AI Enhancement Studio */}
      {drafts.length > 0 && (
        <div className="surface-card p-5 space-y-4 panel-enter">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/55 pb-4">
            <div>
              <h4 className="font-display text-sm font-bold text-slate-900">
                Pratinjau Hasil Studio ({drafts.length} Soal Siap Disimpan)
              </h4>
              <p className="text-xs text-slate-500">
                Tinjau, sempurnakan dengan AI sekali klik, atau ubah tipe &amp; kunci sebelum masuk Bank Soal.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={Boolean(enhancingAction)}
                onClick={() => handleAIEnhance('solve_keys')}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {enhancingAction === 'solve_keys' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
                )}
                <span>Verifikasi Kunci &amp; Pembahasan AI</span>
              </button>

              <button
                type="button"
                disabled={Boolean(enhancingAction)}
                onClick={() => handleAIEnhance('upgrade_hots')}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {enhancingAction === 'upgrade_hots' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-600" />
                ) : (
                  <Zap className="h-3.5 w-3.5 text-amber-600" />
                )}
                <span>Tingkatkan ke HOTS AI</span>
              </button>

              <button
                type="button"
                disabled={Boolean(enhancingAction)}
                onClick={() => handleAIEnhance('fix_formatting')}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-white/65 bg-white/60 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-emerald-300 hover:bg-emerald-500/15 disabled:opacity-50"
              >
                {enhancingAction === 'fix_formatting' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-700" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5 text-emerald-700" />
                )}
                <span>Rapikan Ejaan &amp; Format AI</span>
              </button>

              <button
                type="button"
                disabled={Boolean(enhancingAction)}
                onClick={handleLocalAnalyzeDrafts}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-sky-300/70 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-900 hover:bg-sky-500/20 disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-700" />
                <span>Analisis Struktur (Gratis Lokal)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setDrafts([]);
                  setSuccessMsg(null);
                  setErrorMsg(null);
                }}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl border border-red-300/60 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-500/20"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Kosongkan Draf</span>
              </button>

              <button
                type="button"
                disabled={isSaving}
                onClick={handleSaveAllDrafts}
                className="btn-press inline-flex items-center gap-1.5 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60 shadow-sm"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>
                  {isSaving ? 'Menyimpan...' : `Simpan Semua ke Bank Soal (${activeSubject})`}
                </span>
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {drafts.map((d, idx) => (
              <div
                key={idx}
                className="surface-card-interactive p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex h-6 items-center rounded-lg bg-slate-900 px-2 font-mono-tabular text-[11px] font-bold text-white">
                      #{idx + 1}
                    </span>
                    <select
                      value={d.tipe}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[idx] = { ...d, tipe: e.target.value as QuestionType };
                        setDrafts(next);
                      }}
                      className="glass-input rounded-xl px-2.5 py-1 text-xs font-semibold text-slate-900"
                    >
                      <option value="PG">Pilihan Ganda</option>
                      <option value="PG_KOMPLEKS">PG Kompleks</option>
                      <option value="BENAR_SALAH">Benar / Salah</option>
                      <option value="ESAI">Esai</option>
                    </select>
                    {d.kesulitan && (
                      <span
                        className={`text-[11px] font-semibold ${
                          d.kesulitan === 'Sulit'
                            ? 'text-amber-700'
                            : d.kesulitan === 'Mudah'
                              ? 'text-emerald-700'
                              : 'text-slate-600'
                        }`}
                      >
                        &middot; Level {d.kesulitan}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-slate-500">Bobot:</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={d.bobot}
                        onChange={(e) => {
                          const parsed = Number(e.target.value);
                          const safeBobot = Number.isFinite(parsed)
                            ? Math.max(1, Math.min(100, parsed))
                            : 10;
                          const next = [...drafts];
                          next[idx] = { ...d, bobot: safeBobot };
                          setDrafts(next);
                        }}
                        className="glass-input w-14 rounded-lg px-2 py-0.5 text-xs font-mono-tabular text-center text-slate-900"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Hapus</span>
                    </button>
                  </div>
                </div>

                <div
                  className="rich-question-content text-sm text-slate-900"
                  dangerouslySetInnerHTML={{ __html: d.pertanyaanHtml }}
                />

                {d.opsi.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {d.opsi.map((o, oi) => (
                      <div
                        key={oi}
                        className="glass-subtle rounded-xl px-3 py-2 text-slate-800"
                      >
                        <strong className="font-mono-tabular text-slate-900">
                          {d.tipe === 'BENAR_SALAH' ? '' : `${getOptionLetter(oi)}. `}
                        </strong>
                        {o}
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/50 pt-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <label className="font-semibold text-slate-600">Kunci Jawaban:</label>
                    <input
                      type="text"
                      value={d.kunciJawaban.join(', ')}
                      onChange={(e) => {
                        const next = [...drafts];
                        next[idx] = {
                          ...d,
                          kunciJawaban: e.target.value
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                        };
                        setDrafts(next);
                      }}
                      className="glass-input rounded-xl px-2.5 py-1 text-xs font-mono-tabular font-bold text-emerald-800"
                    />
                  </div>

                  {d.pembahasan && (
                    <p className="glass-subtle text-[11px] text-slate-700 rounded-xl px-3 py-1.5">
                      <strong className="text-emerald-800">Pembahasan AI:</strong> {d.pembahasan}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
