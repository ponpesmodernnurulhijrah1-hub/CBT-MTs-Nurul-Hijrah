import type { ExamResult } from '../types/cbt';
import { getViolationHistoryForResult } from './violationTracker';

export interface SpreadsheetTabInfo {
  sheetId: number;
  title: string;
  rowCount: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: SpreadsheetTabInfo[];
}

export interface SheetExportResult {
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  sheetTitle: string;
  rowCount: number;
}

export function extractSpreadsheetId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch?.[1]) return urlMatch[1];

  if (/^[a-zA-Z0-9-_]{15,80}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function escapeSheetNameForRange(sheetTitle: string, cellRange = 'A1'): string {
  const safeName = sheetTitle.replace(/'/g, "''");
  return `'${safeName}'!${cellRange}`;
}

export function buildExamResultsSheetValues(results: ExamResult[]): (string | number)[][] {
  const headers: string[] = [
    'No',
    'Waktu Submit',
    'Nama Siswa',
    'Kelas',
    'Mata Pelajaran',
    'Judul Ujian',
    'Skor PG',
    'Skor Esai',
    'Nilai Akhir',
    'Status',
    'Keluar Aplikasi',
    'Riwayat Pelanggaran',
  ];

  const rows = results.map((r, idx) => {
    const history = getViolationHistoryForResult(r);
    const historyText =
      history.length > 0
        ? history
            .map(
              (v) =>
                `#${v.strikeNumber} [${new Date(v.timestamp).toLocaleTimeString('id-ID')}] ${v.reason}`
            )
            .join(' | ')
        : '-';

    return [
      idx + 1,
      new Date(r.waktuSubmit).toLocaleString('id-ID'),
      r.namaSiswa,
      r.kelas,
      r.mataPelajaran,
      r.judulUjian,
      r.skorPG,
      r.skorEsai,
      r.nilaiAkhir,
      r.status === 'Selesai' ? 'Selesai (Normal)' : 'Pelanggaran',
      r.pelanggaranTab,
      historyText,
    ];
  });

  return [headers, ...rows];
}

async function parseGoogleSheetsError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string } };
    if (res.status === 401 || res.status === 403) {
      return 'Izin akses Google Sheets ditolak atau kedaluwarsa. Silakan masuk ulang dengan akun Google Anda.';
    }
    if (res.status === 404) {
      return 'Spreadsheet tidak ditemukan. Pastikan URL/ID spreadsheet benar dan dapat diakses oleh akun Google Anda.';
    }
    return data.error?.message || `Google Sheets API error (${res.status})`;
  } catch {
    return `Google Sheets API error (${res.status})`;
  }
}

export async function fetchSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<SpreadsheetMetadata> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title,gridProperties.rowCount)`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error(await parseGoogleSheetsError(res));
  }

  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{
      properties?: {
        sheetId?: number;
        title?: string;
        gridProperties?: { rowCount?: number };
      };
    }>;
  };

  const sheets: SpreadsheetTabInfo[] = (data.sheets || []).map((s) => ({
    sheetId: s.properties?.sheetId ?? 0,
    title: s.properties?.title || 'Sheet',
    rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
  }));

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Spreadsheet Tanpa Judul',
    spreadsheetUrl:
      data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}/edit`,
    sheets,
  };
}

export async function createSpreadsheetWithResults(
  accessToken: string,
  title: string,
  results: ExamResult[]
): Promise<SheetExportResult> {
  const sheetTitle = 'Rekap Nilai CBT';
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: title.trim() || 'Rekap Nilai CBT MTs Nurul Hijrah',
        locale: 'id_ID',
      },
      sheets: [
        {
          properties: {
            title: sheetTitle,
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    }),
  });

  if (!createRes.ok) {
    throw new Error(await parseGoogleSheetsError(createRes));
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl?: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };

  const spreadsheetId = created.spreadsheetId;
  const createdSheetId = created.sheets?.[0]?.properties?.sheetId ?? 0;
  const resolvedSheetTitle = created.sheets?.[0]?.properties?.title || sheetTitle;
  const values = buildExamResultsSheetValues(results);

  const range = escapeSheetNameForRange(resolvedSheetTitle, 'A1');
  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!writeRes.ok) {
    throw new Error(await parseGoogleSheetsError(writeRes));
  }

  // Style header row cleanly (emerald tint + bold dark text)
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: createdSheetId,
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.02, green: 0.47, blue: 0.34 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    bold: true,
                  },
                },
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat)',
            },
          },
        ],
      }),
    }
  ).catch(() => {
    // Non-critical styling failure should not abort export
  });

  return {
    spreadsheetId,
    spreadsheetUrl:
      created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    title: created.properties?.title || title,
    sheetTitle: resolvedSheetTitle,
    rowCount: results.length,
  };
}

export async function writeResultsToExistingSpreadsheet(
  accessToken: string,
  params: {
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetTitle: string;
    mode: 'append' | 'replace';
    results: ExamResult[];
  }
): Promise<SheetExportResult> {
  const { spreadsheetId, spreadsheetTitle, sheetTitle, mode, results } = params;
  const fullValues = buildExamResultsSheetValues(results);

  if (mode === 'replace') {
    const clearRange = escapeSheetNameForRange(sheetTitle, 'A1:Z5000');
    const clearRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(clearRange)}:clear`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    if (!clearRes.ok) {
      throw new Error(await parseGoogleSheetsError(clearRes));
    }

    const writeRange = escapeSheetNameForRange(sheetTitle, 'A1');
    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(writeRange)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ values: fullValues }),
      }
    );
    if (!writeRes.ok) {
      throw new Error(await parseGoogleSheetsError(writeRes));
    }
  } else {
    // Append mode: check if A1 already has a header so we don't duplicate header rows
    const headRange = escapeSheetNameForRange(sheetTitle, 'A1:A1');
    const checkRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(headRange)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    let hasExistingHeader = false;
    if (checkRes.ok) {
      const checkData = (await checkRes.json()) as { values?: unknown[][] };
      hasExistingHeader = Boolean(checkData.values && checkData.values.length > 0);
    }

    const valuesToAppend = hasExistingHeader ? fullValues.slice(1) : fullValues;
    if (valuesToAppend.length > 0) {
      const appendRange = escapeSheetNameForRange(sheetTitle, 'A1');
      const appendRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
          spreadsheetId
        )}/values/${encodeURIComponent(appendRange)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ values: valuesToAppend }),
        }
      );
      if (!appendRes.ok) {
        throw new Error(await parseGoogleSheetsError(appendRes));
      }
    }
  }

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    title: spreadsheetTitle,
    sheetTitle,
    rowCount: results.length,
  };
}
