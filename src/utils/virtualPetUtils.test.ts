import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPetSystemInstruction,
  clampPetPosition,
  computePetMood,
  getDefaultPetPosition,
  isPetIdleSleeping,
  normalizePetActions,
} from './virtualPetUtils.ts';

test('clampPetPosition keeps floating pet strictly inside desktop and mobile viewport bounds', () => {
  const mobile = clampPetPosition(-50, 9999, 390, 844, 92, 12);
  assert.equal(mobile.x, 12);
  assert.equal(mobile.y, 844 - 92 - 12);

  const desktop = clampPetPosition(2000, -10, 1440, 900, 92, 12);
  assert.equal(desktop.x, 1440 - 92 - 12);
  assert.equal(desktop.y, 12);

  const defPos = getDefaultPetPosition(1440, 900);
  assert.ok(defPos.x > 1200 && defPos.y > 700);
});

test('isPetIdleSleeping transitions cleanly after inactivity threshold', () => {
  const now = 100_000;
  assert.equal(isPetIdleSleeping(85_000, now, 22_000), false);
  assert.equal(isPetIdleSleeping(78_000, now, 22_000), true);
  assert.equal(isPetIdleSleeping(50_000, now, 22_000), true);
});

test('computePetMood changes mood based on exam submission, locked exam, and dashboard idle time', () => {
  const now = 200_000;

  // Student submits exam cleanly -> proud
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 1000,
      nowMs: now,
      lastEvent: 'exam_submitted_normal',
      lastEventAtMs: now - 5_000,
    }),
    'proud'
  );

  // Google Sheets export finished -> proud
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 1000,
      nowMs: now,
      lastEvent: 'sheets_exported',
      lastEventAtMs: now - 2_000,
    }),
    'proud'
  );

  // Violation submit -> concerned
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 1000,
      nowMs: now,
      lastEvent: 'exam_submitted_violation',
      lastEventAtMs: now - 4_000,
    }),
    'concerned'
  );

  // Student inside locked exam -> focused
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 20_000,
      nowMs: now,
      isExamLocked: true,
    }),
    'focused'
  );

  // Dashboard idle 16s -> bored; idle 35s -> sleeping
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 16_000,
      nowMs: now,
    }),
    'bored'
  );
  assert.equal(
    computePetMood({
      lastInteractionMs: now - 35_000,
      nowMs: now,
    }),
    'sleeping'
  );
});

test('normalizePetActions translates multilingual animal names, Google Sheets export, and filters invalid actions', () => {
  const actions = normalizePetActions([
    { name: 'change_pet_character', args: { pet: 'burung hantu' } },
    { name: 'change_pet_character', args: { pet: 'gajah' } },
    { name: 'switch_portal', args: { role: 'guru' } },
    { name: 'switch_portal', args: { role: 'hacker' } },
    { name: 'navigate_tab', args: { tab: 'bank-soal' } },
    { name: 'export_google_sheets', args: { mataPelajaran: 'Matematika' } },
    { name: 'create_subject', args: { nama: 'Bahasa Jepang', kode: 'bjep' } },
    { name: 'run_pet_trick', args: { trick: 'hearts' } },
  ]);

  assert.deepEqual(actions, [
    { type: 'change_pet_character', pet: 'owl' },
    { type: 'change_pet_character', pet: 'elephant' },
    { type: 'switch_portal', role: 'guru' },
    { type: 'navigate_tab', tab: 'bank-soal' },
    { type: 'export_google_sheets', mataPelajaran: 'Matematika' },
    { type: 'create_subject', nama: 'Bahasa Jepang', kode: 'BJEP' },
    { type: 'run_pet_trick', trick: 'hearts' },
  ]);
});

test('buildPetSystemInstruction embeds pet persona and enforces exam integrity when locked', () => {
  const normalPrompt = buildPetSystemInstruction('elephant', {
    activeRole: 'guru',
    isExamLocked: false,
    isTeacherLoggedIn: true,
    teacherName: 'Bu Siti',
    teacherSubject: 'Matematika',
    subjects: ['Matematika', 'IPA'],
    classes: ['VIII A'],
  });
  assert.match(normalPrompt, /Bimo/);
  assert.match(normalPrompt, /Bu Siti/);
  assert.doesNotMatch(normalPrompt, /ATURAN UJIAN AKTIF/);

  const examPrompt = buildPetSystemInstruction('cat', {
    activeRole: 'siswa',
    isExamLocked: true,
    subjects: ['Matematika'],
    classes: ['VII A'],
  });
  assert.match(examPrompt, /Miko/);
  assert.match(examPrompt, /ATURAN UJIAN AKTIF/);
});
