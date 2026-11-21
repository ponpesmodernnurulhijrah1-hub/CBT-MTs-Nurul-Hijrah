import React from 'react';
import type { PetCharacterId, PetMood } from '../utils/virtualPetUtils';

interface PetCharacterSvgProps {
  petId: PetCharacterId;
  mood: PetMood;
  size?: number;
}

export const PetCharacterSvg: React.FC<PetCharacterSvgProps> = ({
  petId,
  mood,
  size = 64,
}) => {
  const isSleeping = mood === 'sleeping';
  const isHappy = mood === 'happy';
  const isProud = mood === 'proud';
  const isBored = mood === 'bored';
  const isFocused = mood === 'focused';
  const isConcerned = mood === 'concerned';

  const bodyAnimClass = isHappy
    ? 'pet-jump'
    : isProud
      ? 'pet-proud'
      : isBored
        ? 'pet-bored'
        : isConcerned
          ? 'pet-concerned'
          : isSleeping
            ? 'pet-sleep-breathe'
            : 'pet-breathe';

  const renderStandardOrMoodEyes = (
    leftX: number,
    rightX: number,
    eyeY: number,
    radius = 3.5,
    isOwl = false
  ) => {
    if (isSleeping) {
      return (
        <g stroke="#0F172A" strokeWidth="2.3" strokeLinecap="round">
          <path d={`M${leftX - 4} ${eyeY} Q${leftX} ${eyeY + 3.5} ${leftX + 4} ${eyeY}`} />
          <path d={`M${rightX - 4} ${eyeY} Q${rightX} ${eyeY + 3.5} ${rightX + 4} ${eyeY}`} />
        </g>
      );
    }
    if (isHappy || isProud) {
      return (
        <g stroke="#0F172A" strokeWidth="2.5" strokeLinecap="round">
          <path d={`M${leftX - 4} ${eyeY + 1} Q${leftX} ${eyeY - 4.5} ${leftX + 4} ${eyeY + 1}`} />
          <path d={`M${rightX - 4} ${eyeY + 1} Q${rightX} ${eyeY - 4.5} ${rightX + 4} ${eyeY + 1}`} />
        </g>
      );
    }
    if (isBored) {
      return (
        <g>
          {/* Half-lidded droopy bored eyes */}
          <circle cx={leftX} cy={eyeY + 0.6} r={radius * 0.88} fill="#0F172A" />
          <circle cx={rightX} cy={eyeY + 0.6} r={radius * 0.88} fill="#0F172A" />
          <line
            x1={leftX - radius - 1}
            y1={eyeY - 0.8}
            x2={leftX + radius + 1}
            y2={eyeY - 0.8}
            stroke={isOwl ? '#FFFFFF' : '#1E293B'}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <line
            x1={rightX - radius - 1}
            y1={eyeY - 0.8}
            x2={rightX + radius + 1}
            y2={eyeY - 0.8}
            stroke={isOwl ? '#FFFFFF' : '#1E293B'}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </g>
      );
    }
    return (
      <g className="pet-eye">
        <circle cx={leftX} cy={eyeY} r={radius} fill="#0F172A" />
        <circle cx={rightX} cy={eyeY} r={radius} fill="#0F172A" />
        <circle cx={leftX - 1.2} cy={eyeY - 1.3} r={radius * 0.36} fill="#FFFFFF" />
        <circle cx={rightX - 1.2} cy={eyeY - 1.3} r={radius * 0.36} fill="#FFFFFF" />
        {isConcerned && (
          <g stroke="#0F172A" strokeWidth="1.8" strokeLinecap="round">
            <path d={`M${leftX - 4} ${eyeY - 6} L${leftX + 3} ${eyeY - 4.5}`} />
            <path d={`M${rightX + 4} ${eyeY - 6} L${rightX - 3} ${eyeY - 4.5}`} />
          </g>
        )}
      </g>
    );
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="overflow-visible select-none"
    >
      <defs>
        <radialGradient id="pet-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(15,23,42,0.22)" />
          <stop offset="100%" stopColor="rgba(15,23,42,0)" />
        </radialGradient>
        <linearGradient id="cat-coat" x1="20" y1="16" x2="76" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="55%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#D97706" />
        </linearGradient>
        <linearGradient id="owl-coat" x1="20" y1="18" x2="76" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#BAE6FD" />
          <stop offset="55%" stopColor="#38BDF8" />
          <stop offset="100%" stopColor="#0369A1" />
        </linearGradient>
        <linearGradient id="ele-coat" x1="18" y1="16" x2="78" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#A7F3D0" />
          <stop offset="55%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="fox-coat" x1="20" y1="16" x2="76" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDBA74" />
          <stop offset="55%" stopColor="#FB7185" />
          <stop offset="100%" stopColor="#E11D48" />
        </linearGradient>
      </defs>

      {/* Soft ambient floor shadow */}
      <ellipse cx="48" cy="85" rx="25" ry="6" fill="url(#pet-shadow)" />

      {/* Proud Golden Crown & Sparkles */}
      {isProud && (
        <g className="pointer-events-none">
          <path
            d="M36 16 L40 6 L48 12 L56 6 L60 16 Z"
            fill="#FBBF24"
            stroke="#B45309"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="20" cy="20" r="2.6" fill="#FBBF24" />
          <circle cx="77" cy="21" r="2.4" fill="#F59E0B" />
          <path d="M76 11 V17 M73 14 H79" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round" />
        </g>
      )}

      {/* Bored Thought Ellipsis */}
      {isBored && (
        <g className="pointer-events-none opacity-85">
          <rect x="62" y="10" width="22" height="12" rx="6" fill="#FFFFFF" stroke="#94A3B8" strokeWidth="1.5" />
          <circle cx="68.5" cy="16" r="1.4" fill="#64748B" />
          <circle cx="73" cy="16" r="1.4" fill="#64748B" />
          <circle cx="77.5" cy="16" r="1.4" fill="#64748B" />
        </g>
      )}

      {/* Focused Exam Aura Sparkle */}
      {isFocused && (
        <g className="pointer-events-none">
          <circle cx="75" cy="18" r="5" fill="#0EA5E9" opacity="0.22" />
          <path d="M75 14 V22 M71 18 H79" stroke="#0284C7" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}

      {/* Sleeping Zzz Bubbles */}
      {isSleeping && (
        <g className="pointer-events-none">
          <text
            x="66"
            y="24"
            fill="#0F172A"
            fontSize="12"
            fontWeight="800"
            fontFamily="var(--font-display)"
            className="pet-zzz-1"
          >
            z
          </text>
          <text
            x="74"
            y="16"
            fill="#047857"
            fontSize="15"
            fontWeight="800"
            fontFamily="var(--font-display)"
            className="pet-zzz-2"
          >
            Z
          </text>
        </g>
      )}

      <g className={bodyAnimClass}>
        {petId === 'cat' && (
          <g>
            {/* Waving Tail */}
            <path
              d="M68 68 C82 66, 85 50, 76 44"
              stroke="#D97706"
              strokeWidth="7"
              strokeLinecap="round"
              className={isBored ? '' : 'pet-tail'}
            />
            {/* Ears */}
            <g className={isBored ? '' : 'pet-ear-left'}>
              <path d="M25 36 L22 14 L41 26 Z" fill="#F59E0B" stroke="#B45309" strokeWidth="2" strokeLinejoin="round" />
              <path d="M27 32 L25 19 L36 27 Z" fill="#FDE68A" />
            </g>
            <g className={isBored ? '' : 'pet-ear-right'}>
              <path d="M71 36 L74 14 L55 26 Z" fill="#F59E0B" stroke="#B45309" strokeWidth="2" strokeLinejoin="round" />
              <path d="M69 32 L71 19 L60 27 Z" fill="#FDE68A" />
            </g>
            {/* Body & Head */}
            <ellipse cx="48" cy="64" rx="22" ry="18" fill="url(#cat-coat)" stroke="#B45309" strokeWidth="2" />
            <ellipse cx="48" cy="67" rx="12" ry="11" fill="#FEF3C7" />
            <circle cx="48" cy="43" r="22" fill="url(#cat-coat)" stroke="#B45309" strokeWidth="2" />
            <path d="M44 23 V29 M48 22 V30 M52 23 V29" stroke="#B45309" strokeWidth="2.2" strokeLinecap="round" />
            <ellipse cx="33" cy="48" rx="4" ry="2.4" fill="#FB7185" opacity={isProud ? '0.75' : '0.55'} />
            <ellipse cx="63" cy="48" rx="4" ry="2.4" fill="#FB7185" opacity={isProud ? '0.75' : '0.55'} />
            {renderStandardOrMoodEyes(39, 57, 42, 3.6)}
            <polygon points="48,48 45.5,45.5 50.5,45.5" fill="#F43F5E" />
            {isBored ? (
              <line x1="44" y1="51" x2="52" y2="51" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M44 50 Q46 52.5 48 50 Q50 52.5 52 50" stroke="#78350F" strokeWidth="1.8" strokeLinecap="round" />
            )}
            <path d="M22 44 L31 46 M22 49 L31 49 M74 44 L65 46 M74 49 L65 49" stroke="#92400E" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            <ellipse cx="38" cy="79" rx="5.5" ry="3.5" fill="#FEF3C7" stroke="#B45309" strokeWidth="1.6" />
            <ellipse cx="58" cy="79" rx="5.5" ry="3.5" fill="#FEF3C7" stroke="#B45309" strokeWidth="1.6" />
          </g>
        )}

        {petId === 'owl' && (
          <g>
            <path
              d="M25 48 C14 53, 15 70, 27 72 Z"
              fill="#0284C7"
              stroke="#075985"
              strokeWidth="2"
              className={isBored ? '' : 'pet-wing-left'}
            />
            <path
              d="M71 48 C82 53, 81 70, 69 72 Z"
              fill="#0284C7"
              stroke="#075985"
              strokeWidth="2"
              className={isBored ? '' : 'pet-wing-right'}
            />
            <path d="M28 28 L23 16 L37 22 Z" fill="#0369A1" stroke="#075985" strokeWidth="2" strokeLinejoin="round" className={isBored ? '' : 'pet-ear-left'} />
            <path d="M68 28 L73 16 L59 22 Z" fill="#0369A1" stroke="#075985" strokeWidth="2" strokeLinejoin="round" className={isBored ? '' : 'pet-ear-right'} />
            <ellipse cx="48" cy="52" rx="25" ry="27" fill="url(#owl-coat)" stroke="#075985" strokeWidth="2" />
            <ellipse cx="48" cy="61" rx="16" ry="15" fill="#F0F9FF" />
            <path d="M41 58 Q43 60 45 58 M51 58 Q53 60 55 58 M46 64 Q48 66 50 64" stroke="#7DD3FC" strokeWidth="2" strokeLinecap="round" />
            <circle cx="38" cy="40" r="10.5" fill="#FFFFFF" stroke="#075985" strokeWidth="1.8" />
            <circle cx="58" cy="40" r="10.5" fill="#FFFFFF" stroke="#075985" strokeWidth="1.8" />
            {renderStandardOrMoodEyes(38, 58, 40, 4.4, true)}
            <polygon points="48,50 44,44 52,44" fill="#F59E0B" stroke="#B45309" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M38 78 L36 82 M40 78 L40 82 M42 78 L44 82" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M54 78 L52 82 M56 78 L56 82 M58 78 L60 82" stroke="#D97706" strokeWidth="2.2" strokeLinecap="round" />
          </g>
        )}

        {petId === 'elephant' && (
          <g>
            <ellipse
              cx="23"
              cy="45"
              rx="13"
              ry="17"
              fill="#6EE7B7"
              stroke="#047857"
              strokeWidth="2"
              className={isBored ? '' : 'pet-ear-left'}
            />
            <ellipse cx="24" cy="46" rx="7.5" ry="10.5" fill="#FBCFE8" opacity="0.85" className={isBored ? '' : 'pet-ear-left'} />
            <ellipse
              cx="73"
              cy="45"
              rx="13"
              ry="17"
              fill="#6EE7B7"
              stroke="#047857"
              strokeWidth="2"
              className={isBored ? '' : 'pet-ear-right'}
            />
            <ellipse cx="72" cy="46" rx="7.5" ry="10.5" fill="#FBCFE8" opacity="0.85" className={isBored ? '' : 'pet-ear-right'} />
            <ellipse cx="48" cy="63" rx="21" ry="17" fill="url(#ele-coat)" stroke="#047857" strokeWidth="2" />
            <circle cx="48" cy="43" r="21" fill="url(#ele-coat)" stroke="#047857" strokeWidth="2" />
            <ellipse cx="33" cy="48" rx="3.8" ry="2.2" fill="#FB7185" opacity={isProud ? '0.75' : '0.55'} />
            <ellipse cx="63" cy="48" rx="3.8" ry="2.2" fill="#FB7185" opacity={isProud ? '0.75' : '0.55'} />
            {renderStandardOrMoodEyes(39, 57, 40, 3.4)}
            <path
              d="M48 45 C48 56, 54 62, 60 58 C62 56.5, 61 53, 58.5 54"
              stroke="#047857"
              strokeWidth="8.5"
              strokeLinecap="round"
              className={isBored ? '' : 'pet-trunk'}
            />
            <path
              d="M48 45 C48 56, 54 62, 60 58 C62 56.5, 61 53, 58.5 54"
              stroke="#6EE7B7"
              strokeWidth="5"
              strokeLinecap="round"
              className={isBored ? '' : 'pet-trunk'}
            />
            <ellipse cx="38" cy="79" rx="6" ry="3.8" fill="#A7F3D0" stroke="#047857" strokeWidth="1.6" />
            <ellipse cx="58" cy="79" rx="6" ry="3.8" fill="#A7F3D0" stroke="#047857" strokeWidth="1.6" />
          </g>
        )}

        {petId === 'fox' && (
          <g>
            <g className={isBored ? '' : 'pet-tail'}>
              <path
                d="M66 67 C82 65, 86 48, 76 42 C70 46, 65 55, 65 65 Z"
                fill="#FB7185"
                stroke="#BE123C"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <circle cx="77" cy="45" r="4.5" fill="#FFF1F2" />
            </g>
            <g className={isBored ? '' : 'pet-ear-left'}>
              <path d="M24 37 L20 12 L42 25 Z" fill="#FB7185" stroke="#BE123C" strokeWidth="2" strokeLinejoin="round" />
              <path d="M26 33 L24 18 L37 26 Z" fill="#FFE4E6" />
            </g>
            <g className={isBored ? '' : 'pet-ear-right'}>
              <path d="M72 37 L76 12 L54 25 Z" fill="#FB7185" stroke="#BE123C" strokeWidth="2" strokeLinejoin="round" />
              <path d="M70 33 L72 18 L59 26 Z" fill="#FFE4E6" />
            </g>
            <ellipse cx="48" cy="64" rx="21" ry="17" fill="url(#fox-coat)" stroke="#BE123C" strokeWidth="2" />
            <ellipse cx="48" cy="67" rx="11.5" ry="11" fill="#FFF1F2" />
            <circle cx="48" cy="43" r="21.5" fill="url(#fox-coat)" stroke="#BE123C" strokeWidth="2" />
            <path d="M27 45 Q37 44 48 54 Q59 44 69 45 Q64 62 48 63 Q32 62 27 45 Z" fill="#FFF1F2" />
            <ellipse cx="34" cy="49" rx="3.8" ry="2.2" fill="#FDA4AF" opacity={isProud ? '0.85' : '0.7'} />
            <ellipse cx="62" cy="49" rx="3.8" ry="2.2" fill="#FDA4AF" opacity={isProud ? '0.85' : '0.7'} />
            {renderStandardOrMoodEyes(39, 57, 41, 3.5)}
            <circle cx="48" cy="50" r="2.8" fill="#1E293B" />
            {isBored ? (
              <line x1="44" y1="54.5" x2="52" y2="54.5" stroke="#881337" strokeWidth="1.8" strokeLinecap="round" />
            ) : (
              <path d="M44 54 Q48 57 52 54" stroke="#881337" strokeWidth="1.8" strokeLinecap="round" />
            )}
            <ellipse cx="38" cy="79" rx="5.5" ry="3.5" fill="#FFF1F2" stroke="#BE123C" strokeWidth="1.6" />
            <ellipse cx="58" cy="79" rx="5.5" ry="3.5" fill="#FFF1F2" stroke="#BE123C" strokeWidth="1.6" />
          </g>
        )}
      </g>
    </svg>
  );
};
