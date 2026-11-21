import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Heart,
  MessageCircle,
  Send,
  Settings2,
  Sparkles,
  Star,
  Wand2,
  X,
} from 'lucide-react';
import {
  clampPetPosition,
  computePetMood,
  getDefaultPetPosition,
  isValidPetId,
  PET_CHARACTER_LIST,
  PET_CHARACTERS,
  PET_MOODS,
  type PetActivityEvent,
  type PetAppContextSummary,
  type PetCharacterId,
  type PetClientAction,
  type PetMood,
} from '../utils/virtualPetUtils';
import { PetCharacterSvg } from './PetCharacterSvg';

const PET_STORAGE_KEY = 'cbt_virtual_pet_character_v1';
const PET_OFFSET_KEY = 'cbt_virtual_pet_offset_v2';
const PET_HIDDEN_KEY = 'cbt_virtual_pet_hidden_v1';
const WIDGET_SIZE = 92;

interface ParticleItem {
  id: number;
  kind: 'heart' | 'star';
  offsetX: number;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  executedLabels?: string[];
}

export interface PetActivitySignal {
  id: number;
  event: PetActivityEvent;
  detail?: string;
}

interface VirtualPetAssistantProps {
  appContext: PetAppContextSummary;
  activitySignal?: PetActivitySignal | null;
  onExecuteAction: (action: PetClientAction) => Promise<string | void> | string | void;
}

function renderFormattedText(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return (
        <em key={idx} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function offsetToTopLeft(
  rightOffset: number,
  bottomOffset: number,
  vw: number,
  vh: number
): { x: number; y: number } {
  return clampPetPosition(
    vw - WIDGET_SIZE - rightOffset,
    vh - WIDGET_SIZE - Math.max(24, bottomOffset),
    vw,
    vh,
    WIDGET_SIZE,
    18
  );
}

export const VirtualPetAssistant: React.FC<VirtualPetAssistantProps> = ({
  appContext,
  activitySignal,
  onExecuteAction,
}) => {
  const [petId, setPetId] = useState<PetCharacterId>(() => {
    try {
      const saved = localStorage.getItem(PET_STORAGE_KEY);
      if (isValidPetId(saved)) return saved;
    } catch {
      // Ignore storage failures
    }
    return 'cat';
  });

  const [hidden, setHidden] = useState<boolean>(() => {
    try {
      return localStorage.getItem(PET_HIDDEN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    try {
      const raw = localStorage.getItem(PET_OFFSET_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { right?: number; bottom?: number };
        if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
          return offsetToTopLeft(parsed.right, parsed.bottom, vw, vh);
        }
      }
    } catch {
      // Ignore invalid position cache
    }
    return getDefaultPetPosition(vw, vh, WIDGET_SIZE, 28);
  });

  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isHappy, setIsHappy] = useState(false);
  const [currentMood, setCurrentMood] = useState<PetMood>('idle');
  const [speechBubble, setSpeechBubble] = useState<string | null>(null);
  const [particles, setParticles] = useState<ParticleItem[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'model',
      text: 'Halo! Aku asisten pintar CBT MTs Nurul Hijrah. Tanya materi apa saja, minta buatkan soal, ekspor ke Google Sheets, atau suruh aku melakukan apa pun!',
    },
  ]);

  const lastActivityRef = useRef<number>(Date.now());
  const lastEventRef = useRef<{ event: PetActivityEvent; atMs: number } | null>(null);
  const bubbleTimerRef = useRef<number | null>(null);
  const happyTimerRef = useRef<number | null>(null);
  const particleIdRef = useRef(1);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
    moved: false,
  });

  const petMeta = PET_CHARACTERS[petId];

  const updatePetCharacter = useCallback((nextPet: PetCharacterId) => {
    setPetId(nextPet);
    try {
      localStorage.setItem(PET_STORAGE_KEY, nextPet);
    } catch {
      // Ignore
    }
  }, []);

  const updateHiddenState = useCallback((nextHidden: boolean) => {
    setHidden(nextHidden);
    if (nextHidden) {
      setChatOpen(false);
      setSettingsOpen(false);
    }
    try {
      localStorage.setItem(PET_HIDDEN_KEY, String(nextHidden));
    } catch {
      // Ignore
    }
  }, []);

  const showBubble = useCallback((text: string, durationMs = 4200) => {
    setSpeechBubble(text);
    if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => {
      setSpeechBubble(null);
    }, durationMs);
  }, []);

  const spawnParticles = useCallback((count = 4) => {
    const batch: ParticleItem[] = Array.from({ length: count }, (_, idx) => ({
      id: particleIdRef.current++,
      kind: idx % 2 === 0 ? 'heart' : 'star',
      offsetX: Math.round((idx - (count - 1) / 2) * 16 + (Math.random() * 8 - 4)),
    }));
    setParticles((prev) => [...prev.slice(-8), ...batch]);
    window.setTimeout(() => {
      const ids = new Set(batch.map((b) => b.id));
      setParticles((prev) => prev.filter((p) => !ids.has(p.id)));
    }, 1100);
  }, []);

  const triggerJoyfulReaction = useCallback(
    (customBubble?: string) => {
      lastActivityRef.current = Date.now();
      setIsHappy(true);
      setCurrentMood('happy');
      spawnParticles(4);
      if (happyTimerRef.current) window.clearTimeout(happyTimerRef.current);
      happyTimerRef.current = window.setTimeout(() => setIsHappy(false), 620);

      if (customBubble) {
        showBubble(customBubble);
      } else {
        const greetings = petMeta.greetingWords;
        const pick = greetings[Math.floor(Math.random() * greetings.length)];
        showBubble(pick);
      }
    },
    [petMeta.greetingWords, showBubble, spawnParticles]
  );

  // React to meaningful app activity signals (exam submitted -> proud, violation -> concerned, sheets exported -> proud, etc.)
  useEffect(() => {
    if (!activitySignal) return;
    const now = Date.now();
    lastActivityRef.current = now;

    if (activitySignal.event === 'exam_submitted_normal') {
      lastEventRef.current = { event: 'exam_submitted_normal', atMs: now };
      setCurrentMood('proud');
      spawnParticles(6);
      showBubble(
        activitySignal.detail || `Hore! Ujian selesai dikumpulkan — ${petMeta.name} bangga padamu!`,
        5500
      );
    } else if (activitySignal.event === 'exam_submitted_violation') {
      lastEventRef.current = { event: 'exam_submitted_violation', atMs: now };
      setCurrentMood('concerned');
      showBubble(
        activitySignal.detail || 'Ujian terkumpul otomatis karena pelanggaran. Tetap jujur dan semangat!',
        5200
      );
    } else if (
      activitySignal.event === 'sheets_exported' ||
      activitySignal.event === 'excel_exported' ||
      activitySignal.event === 'questions_saved' ||
      activitySignal.event === 'schedule_toggled' ||
      activitySignal.event === 'ai_command_success'
    ) {
      lastEventRef.current = { event: activitySignal.event, atMs: now };
      setCurrentMood('proud');
      spawnParticles(5);
      if (activitySignal.detail) {
        showBubble(activitySignal.detail, 4600);
      }
    } else if (activitySignal.event === 'exam_started') {
      lastEventRef.current = null;
      setCurrentMood('focused');
      showBubble(`Semangat ujian! ${petMeta.name} ikut menjaga fokusmu.`, 4000);
    } else {
      lastEventRef.current = null;
      setCurrentMood('idle');
    }
  }, [activitySignal, petMeta.name, showBubble, spawnParticles]);

  // Wake up on user interaction anywhere & compute real-time mood transitions (bored -> sleeping -> idle)
  useEffect(() => {
    let lastMoveStamp = 0;
    const syncMoodNow = () => {
      const next = computePetMood({
        isLoading: loading,
        isHappyOverride: isHappy,
        isExamLocked: appContext.isExamLocked,
        lastInteractionMs: lastActivityRef.current,
        nowMs: Date.now(),
        lastEvent: lastEventRef.current?.event ?? null,
        lastEventAtMs: lastEventRef.current?.atMs ?? null,
      });
      setCurrentMood(next);
    };

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      syncMoodNow();
    };
    const handlePointerMove = () => {
      const now = Date.now();
      if (now - lastMoveStamp < 400) return;
      lastMoveStamp = now;
      markActivity();
    };

    window.addEventListener('pointerdown', markActivity, { passive: true });
    window.addEventListener('keydown', markActivity, { passive: true });
    window.addEventListener('touchstart', markActivity, { passive: true });
    window.addEventListener('pointermove', handlePointerMove, { passive: true });

    syncMoodNow();
    const interval = window.setInterval(() => {
      if (chatOpen || settingsOpen) return;
      syncMoodNow();
    }, 1000);

    return () => {
      window.removeEventListener('pointerdown', markActivity);
      window.removeEventListener('keydown', markActivity);
      window.removeEventListener('touchstart', markActivity);
      window.removeEventListener('pointermove', handlePointerMove);
      window.clearInterval(interval);
    };
  }, [appContext.isExamLocked, chatOpen, isHappy, loading, settingsOpen]);

  // Keep pet clamped inside viewport on browser resize using bottom-right affinity if saved
  useEffect(() => {
    const handleResize = () => {
      try {
        const raw = localStorage.getItem(PET_OFFSET_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { right?: number; bottom?: number };
          if (typeof parsed.right === 'number' && typeof parsed.bottom === 'number') {
            setPosition(offsetToTopLeft(parsed.right, parsed.bottom, window.innerWidth, window.innerHeight));
            return;
          }
        }
      } catch {
        // Fallback to clamp
      }
      setPosition(getDefaultPetPosition(window.innerWidth, window.innerHeight, WIDGET_SIZE, 28));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-scroll chat history
  useEffect(() => {
    if (chatOpen && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, loading, chatOpen]);

  // Drag & drop pointer handling
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || (st.pointerId !== null && e.pointerId !== st.pointerId)) return;
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (Math.hypot(dx, dy) > 6) {
        st.moved = true;
      }
      if (!st.moved) return;
      const next = clampPetPosition(
        st.originX + dx,
        st.originY + dy,
        window.innerWidth,
        window.innerHeight,
        WIDGET_SIZE,
        18
      );
      setPosition(next);
    };

    const handlePointerUp = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st.active || (st.pointerId !== null && e.pointerId !== st.pointerId)) return;
      const wasDragged = st.moved;
      st.active = false;
      st.pointerId = null;

      if (wasDragged) {
        setPosition((latest) => {
          try {
            const right = Math.max(16, window.innerWidth - WIDGET_SIZE - latest.x);
            const bottom = Math.max(24, window.innerHeight - WIDGET_SIZE - latest.y);
            localStorage.setItem(PET_OFFSET_KEY, JSON.stringify({ right, bottom }));
          } catch {
            // Ignore
          }
          return latest;
        });
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, []);

  const handleAvatarPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    lastActivityRef.current = Date.now();
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
  };

  const handleAvatarClick = () => {
    if (dragStateRef.current.moved) {
      dragStateRef.current.moved = false;
      return;
    }
    triggerJoyfulReaction();
    setSettingsOpen(false);
    setChatOpen((prev) => !prev);
  };

  const runActionLocally = useCallback(
    async (action: PetClientAction): Promise<string | null> => {
      if (action.type === 'change_pet_character') {
        updatePetCharacter(action.pet);
        spawnParticles(5);
        showBubble(`Taraa! Sekarang aku jadi ${PET_CHARACTERS[action.pet].speciesLabel}!`);
        return `Bentuk diubah ke ${PET_CHARACTERS[action.pet].speciesLabel}`;
      }
      if (action.type === 'set_pet_visibility') {
        updateHiddenState(!action.visible);
        return action.visible ? 'Asisten hewan ditampilkan' : 'Asisten hewan disembunyikan';
      }
      if (action.type === 'run_pet_trick') {
        if (action.trick === 'sleep') {
          lastActivityRef.current = Date.now() - 35_000;
          setCurrentMood('sleeping');
          showBubble('Zzz... Selamat istirahat sebentar~');
          return 'Mode tidur aktif';
        }
        if (action.trick === 'hearts') {
          spawnParticles(7);
          lastEventRef.current = { event: 'ai_command_success', atMs: Date.now() };
          setCurrentMood('proud');
          showBubble('Penuh cinta, bangga, dan semangat belajar!');
          return 'Hujan hati & mode bangga!';
        }
        triggerJoyfulReaction('Hap! Semangat terus ya!');
        return 'Lompatan ceria!';
      }

      const feedback = await onExecuteAction(action);
      return feedback || null;
    },
    [onExecuteAction, showBubble, spawnParticles, triggerJoyfulReaction, updateHiddenState, updatePetCharacter]
  );

  const sendMessage = async (promptText: string) => {
    const clean = promptText.trim();
    if (!clean || loading) return;

    lastActivityRef.current = Date.now();

    const nextHistory = [...messages, { role: 'user' as const, text: clean }];
    setMessages(nextHistory);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/gemini/pet-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          history: nextHistory.slice(-8).map((m) => ({ role: m.role, text: m.text })),
          petType: petId,
          appContext,
        }),
      });

      const data = (await res.json()) as {
        reply?: string;
        actions?: PetClientAction[];
        error?: string;
      };

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'model',
            text: data.error || 'Maaf, asisten hewan gagal terhubung ke layanan AI.',
          },
        ]);
        return;
      }

      const executedLabels: string[] = [];
      for (const act of data.actions || []) {
        const label = await runActionLocally(act);
        if (label) executedLabels.push(label);
      }

      if ((data.actions || []).length > 0) {
        lastEventRef.current = { event: 'ai_command_success', atMs: Date.now() };
        setCurrentMood('proud');
        spawnParticles(5);
      } else {
        spawnParticles(3);
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: data.reply || 'Siap! Ada lagi yang bisa kubantu?',
          executedLabels: executedLabels.length > 0 ? executedLabels : undefined,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: 'model',
          text: 'Koneksi ke server AI sedang terputus. Periksa jaringan lalu coba kirim ulang.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickChips: string[] = appContext.isExamLocked
    ? ['Berapa sisa waktuku?', 'Kasih aku semangat dong!', 'Sembunyikan asisten']
    : appContext.activeRole === 'guru'
      ? [
          'Buatkan 3 soal PG Matematika tentang pecahan',
          'Impor hasil ke Google Sheets',
          'Ekspor nilai ke Excel',
          'Ubah bentukmu jadi burung hantu',
        ]
      : appContext.activeRole === 'admin'
        ? [
            'Impor semua hasil ke Google Sheets',
            'Buka Live Monitoring Pusat',
            'Ubah bentukmu jadi gajah mini',
            'Ringkaskan jadwal ujian yang aktif',
          ]
        : [
            'Jadwal ujian apa yang sedang dibuka?',
            'Jelaskan rumus Teorema Pythagoras',
            'Buka QR Install HP',
            'Ganti karakter jadi rubah',
          ];

  const moodMeta = PET_MOODS[currentMood];

  const isNearLeftEdge = typeof window !== 'undefined' && position.x < window.innerWidth * 0.4;
  const isNearTopEdge = position.y < 150;

  // Compact unobtrusive restore button when hidden so student/teacher never loses access
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => {
          updateHiddenState(false);
          triggerJoyfulReaction(`Halo lagi! ${petMeta.name} siap membantu!`);
        }}
        aria-label="Tampilkan Asisten Hewan Peliharaan"
        title="Panggil kembali Asisten Hewan AI"
        className="btn-press glass-modal fixed bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-semibold text-slate-800 shadow-md hover:bg-white no-print"
      >
        <Eye className="h-3.5 w-3.5 text-emerald-700" />
        <span className="hidden sm:inline whitespace-nowrap">Panggil {petMeta.name}</span>
      </button>
    );
  }

  return (
    <div className="no-print">
      {/* Floating Draggable Virtual Pet Widget (smoothly concealed while chat drawer is open) */}
      {!chatOpen && (
        <div
          style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
          className="fixed left-0 top-0 z-40 w-[92px] h-[92px] select-none"
        >
          {/* Animated Floating Hearts & Stars */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-4 flex justify-center"
          >
            {particles.map((pt) => (
              <span
                key={pt.id}
                style={{ marginLeft: pt.offsetX }}
                className="pet-particle absolute"
              >
                {pt.kind === 'heart' ? (
                  <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500 drop-shadow-xs" />
                ) : (
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500 drop-shadow-xs" />
                )}
              </span>
            ))}
          </div>

          {/* High-Contrast Frosted Speech Bubble */}
          {speechBubble && !settingsOpen && (
            <div
              role="status"
              className={`glass-modal pointer-events-none absolute w-56 rounded-2xl px-3.5 py-2.5 text-[11px] font-semibold leading-snug text-slate-900 shadow-lg ${
                isNearTopEdge ? 'top-[96px]' : 'bottom-[96px]'
              } ${isNearLeftEdge ? 'left-0' : 'right-0'}`}
            >
              <p className="text-[10px] font-bold text-emerald-800 mb-0.5">
                {petMeta.name} · {petMeta.speciesLabel}
              </p>
              <p>{speechBubble}</p>
            </div>
          )}

          {/* Quick Pet Character Picker Popover */}
          {settingsOpen && (
            <div
              role="dialog"
              aria-label="Pilih Karakter Hewan Peliharaan"
              className={`glass-modal absolute z-20 w-60 p-3 shadow-xl ${
                isNearTopEdge ? 'top-[98px]' : 'bottom-[98px]'
              } ${isNearLeftEdge ? 'left-0' : 'right-0'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-display text-xs font-bold text-slate-900">
                  Pilih Teman Hewan
                </span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Tutup menu hewan"
                  className="btn-press rounded-lg p-1 text-slate-500 hover:bg-slate-200/60"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {PET_CHARACTER_LIST.map((item) => {
                  const active = item.id === petId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        updatePetCharacter(item.id);
                        setSettingsOpen(false);
                        triggerJoyfulReaction(`Hai! Aku ${item.name}, ${item.speciesLabel}!`);
                      }}
                      className={`btn-press flex flex-col items-center rounded-xl border p-2 text-center transition-all ${
                        active
                          ? 'border-emerald-500/70 bg-emerald-500/15 text-emerald-950 font-bold'
                          : 'border-slate-200/80 bg-white/75 text-slate-700 hover:bg-white'
                      }`}
                    >
                      <PetCharacterSvg petId={item.id} mood="idle" size={34} />
                      <span className="mt-1 text-[11px] leading-tight">
                        {item.speciesLabel.split(' ')[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => updateHiddenState(true)}
                className="btn-press mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/75 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white"
              >
                <EyeOff className="h-3 w-3" />
                <span>Sembunyikan Saat Ujian</span>
              </button>
            </div>
          )}

          {/* Quick Corner Micro-Controls (Switch Character & Hide) */}
          <div className="absolute -top-2 -right-1 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((s) => !s);
              }}
              aria-label="Ganti karakter hewan peliharaan"
              title="Ganti Karakter Hewan"
              className="btn-press flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90 text-slate-700 shadow-xs backdrop-blur-md hover:bg-white"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateHiddenState(true);
              }}
              aria-label="Sembunyikan asisten hewan"
              title="Sembunyikan (agar tidak mengganggu ujian)"
              className="btn-press flex h-6 w-6 items-center justify-center rounded-full border border-white/80 bg-white/90 text-slate-600 shadow-xs backdrop-blur-md hover:bg-red-50 hover:text-red-700"
            >
              <EyeOff className="h-3 w-3" />
            </button>
          </div>

          {/* Main Draggable & Clickable Pet Glass Medallion + Live Mood Indicator */}
          <button
            type="button"
            onPointerDown={handleAvatarPointerDown}
            onClick={handleAvatarClick}
            onMouseEnter={() => {
              if (!dragStateRef.current.active && !settingsOpen) {
                triggerJoyfulReaction();
              }
            }}
            aria-label={`Buka Asisten AI ${petMeta.name} (${petMeta.speciesLabel}) · Mood ${moodMeta.label} — geser untuk memindahkan`}
            style={{ touchAction: 'none' }}
            className={`group relative flex h-[84px] w-[84px] cursor-grab active:cursor-grabbing flex-col items-center justify-center rounded-3xl border bg-gradient-to-br ${petMeta.accentBg} ${petMeta.ringColor} backdrop-blur-xl shadow-[0_14px_30px_-10px_rgba(15,23,42,0.22),inset_0_1px_0_rgba(255,255,255,0.85)] transition-transform duration-200 hover:scale-105`}
          >
            <PetCharacterSvg
              petId={petId}
              mood={currentMood}
              size={60}
            />
            <span className="-mt-1 inline-flex items-center gap-1 rounded-lg bg-white/85 px-1.5 py-0.5 text-[9.5px] font-bold text-slate-800 shadow-2xs">
              <MessageCircle className="h-2.5 w-2.5 text-emerald-700" />
              <span>{petMeta.name} AI</span>
            </span>
          </button>

          {/* Visual Activity-Driven Mood Pill Indicator */}
          <div
            data-testid="pet-mood-indicator"
            data-mood={currentMood}
            title={moodMeta.statusHint}
            aria-label={`Mood hewan: ${moodMeta.label}`}
            className={`pointer-events-none mx-auto -mt-1 flex w-max max-w-[104px] items-center justify-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold shadow-xs backdrop-blur-md transition-all duration-300 ${moodMeta.pillTone}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${moodMeta.dotColor} ${currentMood === 'proud' ? 'animate-ping' : ''}`} />
            <span className="truncate">{moodMeta.label}</span>
          </div>
        </div>
      )}

      {/* Interactive AI Assistant Chat Sheet (iOS Glassmorphism) */}
      {chatOpen && (
        <div
          role="dialog"
          aria-label={`Asisten AI ${petMeta.name}`}
          className="glass-modal fixed bottom-4 right-3 sm:right-5 z-50 flex h-[540px] max-h-[82vh] w-[calc(100vw-24px)] sm:w-[400px] flex-col overflow-hidden"
        >
          {/* Dark Frosted Glass Header */}
          <div className="glass-dark flex items-center justify-between gap-2 border-b border-white/15 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/15 border border-white/25">
                <PetCharacterSvg
                  petId={petId}
                  mood={currentMood}
                  size={36}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="font-display text-sm font-bold truncate">
                    {petMeta.name} · {petMeta.speciesLabel}
                  </h3>
                  <span
                    data-testid="pet-chat-mood-indicator"
                    data-mood={currentMood}
                    className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white whitespace-nowrap"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${moodMeta.dotColor}`} />
                    <span>{moodMeta.label}</span>
                  </span>
                </div>
                <p className="text-[11px] text-emerald-200/90 truncate">
                  {moodMeta.statusHint}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => updateHiddenState(true)}
                title="Sembunyikan asisten hewan"
                aria-label="Sembunyikan asisten hewan"
                className="btn-press rounded-xl p-1.5 text-slate-200 hover:bg-white/15"
              >
                <EyeOff className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Tutup jendela obrolan"
                className="btn-press rounded-xl p-1.5 text-slate-200 hover:bg-white/15"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Quick Character Switcher Bar */}
          <div className="border-b border-white/50 bg-white/40 px-3 py-2">
            <div className="grid grid-cols-4 gap-1.5">
              {PET_CHARACTER_LIST.map((item) => {
                const active = item.id === petId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      updatePetCharacter(item.id);
                      triggerJoyfulReaction(`Halo! Sekarang aku ${item.name}!`);
                    }}
                    className={`btn-press flex items-center justify-center gap-1 rounded-xl border px-2 py-1 text-[11px] font-semibold transition-all whitespace-nowrap ${
                      active
                        ? 'border-emerald-500/60 bg-emerald-700 text-white shadow-xs'
                        : 'border-white/70 bg-white/60 text-slate-700 hover:bg-white'
                    }`}
                  >
                    <PetCharacterSvg petId={item.id} mood="idle" size={20} />
                    <span>{item.speciesLabel.split(' ')[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chat Transcript */}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-line ${
                  msg.role === 'user'
                    ? 'ml-8 bg-emerald-700 text-white shadow-xs'
                    : 'glass-subtle mr-4 text-slate-800'
                }`}
              >
                <p>{renderFormattedText(msg.text)}</p>
                {msg.executedLabels && msg.executedLabels.length > 0 && (
                  <div className="mt-2 border-t border-emerald-500/20 pt-1.5 space-y-1">
                    {msg.executedLabels.map((lbl, i) => (
                      <p
                        key={i}
                        className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800"
                      >
                        <Wand2 className="h-3 w-3 shrink-0" />
                        <span>{lbl}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="glass-subtle mr-6 rounded-2xl px-3.5 py-2.5 text-xs text-slate-600 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-emerald-700 animate-spin" />
                <span>{petMeta.name} sedang berpikir &amp; memproses perintah...</span>
              </div>
            )}

            {/* Quick Suggestion Chips */}
            <div className="pt-2 space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-500">
                Coba tanya atau perintahkan:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickChips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={loading}
                    onClick={() => void sendMessage(chip)}
                    className="btn-press rounded-xl border border-emerald-400/45 bg-emerald-500/10 px-2.5 py-1.5 text-left text-[11px] font-medium text-emerald-950 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Prompt Input Bar */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage(input);
            }}
            className="flex items-center gap-2 border-t border-white/55 bg-white/45 p-3"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Tanya atau perintah ${petMeta.name}...`}
              className="glass-input flex-1 rounded-xl px-3.5 py-2 text-xs text-slate-900"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              aria-label="Kirim pertanyaan atau perintah ke asisten hewan"
              className="btn-press rounded-xl bg-emerald-700 p-2.5 text-white hover:bg-emerald-800 disabled:opacity-45 shadow-xs"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </form>
        </div>
      )}
    </div>
  );
};
