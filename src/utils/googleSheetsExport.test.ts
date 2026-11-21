import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExamResult } from '../types/cbt';
import {
  buildExamResultsSheetValues,
  escapeSheetNameForRange,
  extractSpreadsheetId,
} from './googleSheetsExport';

test('extractSpreadsheetId parses full Google Sheets URLs and raw IDs cleanly', () => {
  assert.equal(
    extractSpreadsheetId(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0'
    ),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(
    extractSpreadsheetId('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'),
    '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms'
  );
  assert.equal(extractSpreadsheetId('invalid short'), null);
});

test('escapeSheetNameForRange escapes single quotes for A1 range notation', () => {
  assert.equal(
    escapeSheetNameForRange("Nilai Kelas VII'A", 'A1'),
    "'Nilai Kelas VII''A'!A1"
  );
});

test('buildExamResultsSheetValues constructs header row and formatted student rows', () => {
  const sample: ExamResult[] = [
    {
      id: 'res-1',
      examId: 'exam-1',
      namaSiswa: 'Ahmad Fauzi',
      kelas: 'VII A',
      mataPelajaran: 'Matematika',
      judulUjian: 'Penilaian Harian 1',
      jawabanDetail: [],
      skorPG: 90,
      skorEsai: 0,
      nilaiAkhir: 90,
      status: 'Selesai',
      pelanggaranTab: 0,
      waktuSubmit: '2026-11-20T09:00:00.000Z',
    },
  ];

  const values = buildExamResultsSheetValues(sample);
  assert.equal(values.length, 2);
  assert.equal(values[0][0], 'No');
  assert.equal(values[0][2], 'Nama Siswa');
  assert.equal(values[0][8], 'Nilai Akhir');
  assert.equal(values[1][2], 'Ahmad Fauzi');
  assert.equal(values[1][8], 90);
  assert.equal(values[1][9], 'Selesai (Normal)');
});
