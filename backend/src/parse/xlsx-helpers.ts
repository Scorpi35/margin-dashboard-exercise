import * as XLSX from 'xlsx';

/**
 * Primitives every file parser leans on, so each one stays short enough to read
 * in a sitting.
 *
 * The three source files disagree with each other in small ways that are easy to
 * miss (`docs/data-sources.md`): the salary sheet's header sits in row 2 under a
 * title row, and the timesheet's column names are long enough that nobody types
 * them exactly — the real header is `"Company Name (Billable)/ Fixed Costs..."`,
 * spaced differently from how the docs quote it. Columns are therefore located by
 * case-insensitive substring, never by exact text.
 */

/** Characters a human writes in a cell to mean "nothing here". */
const BLANK_DASHES = new Set(['-', '–', '—']);

/** Thousands separators and surrounding whitespace. JS `\s` covers the non-breaking space. */
const NUMERIC_NOISE = /[\s,]/g;

/**
 * What a real workbook starts with: `.xlsx` is a ZIP archive, legacy `.xls` an
 * OLE2 compound file. SheetJS sniffs formats and will happily read a plain text
 * file as a one-column CSV, so without this check a `.txt` renamed to `.xlsx`
 * parses into a single-cell sheet and half-ingests instead of being rejected.
 */
const WORKBOOK_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
];

/**
 * One spreadsheet row, keyed by its trimmed header.
 *
 * `rowNumber` is carried alongside the values because fully-blank rows are
 * skipped: the position in this array stops matching the row the user sees in
 * Excel, and `ParseWarning.row` has to cite the latter to be worth anything.
 */
export interface SheetRow {
  /** 1-indexed, exactly as Excel's row gutter shows it. */
  readonly rowNumber: number;
  readonly values: Record<string, unknown>;
}

/**
 * Reads an uploaded `.xlsx` buffer.
 *
 * @throws if the buffer is not a readable spreadsheet. A structurally wrong file
 * fails here, loudly, rather than half-ingesting.
 */
export function loadWorkbook(buffer: Buffer): XLSX.WorkBook {
  const isWorkbook = WORKBOOK_SIGNATURES.some((signature) =>
    buffer.subarray(0, signature.length).equals(signature),
  );
  if (!isWorkbook) {
    throw new Error(
      'Could not read the file as a spreadsheet: it is not an .xlsx or .xls workbook.',
    );
  }

  let workbook: XLSX.WorkBook;

  try {
    // `cellDates` stays off: date cells arrive as Excel serials, which
    // `parse/dates.ts` already knows how to resolve.
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the file as a spreadsheet: ${detail}`);
  }

  if (workbook.SheetNames.length === 0) {
    throw new Error('The spreadsheet contains no sheets.');
  }

  return workbook;
}

/**
 * Finds the row the column names live on, by scoring the first `maxRowsToScan`
 * rows on how many expected names they contain.
 *
 * Assuming row 1 would break the salary sheet, whose header sits in row 2 beneath
 * a `"Salary Overview 2025 (AED)"` title. Scoring also degrades gracefully when a
 * column is renamed, where an exact-match check would simply fail.
 *
 * @returns the 0-indexed row, relative to the start of the sheet's range.
 * @throws if no scanned row contains any expected name — the file isn't what it
 * claims to be.
 */
export function findHeaderRow(
  sheet: XLSX.WorkSheet,
  expectedHeaders: readonly string[],
  maxRowsToScan = 10,
): number {
  const matrix = sheetMatrix(sheet);
  const needles = expectedHeaders
    .map((header) => header.trim().toLowerCase())
    .filter((header) => header !== '');

  const limit = Math.min(maxRowsToScan, matrix.length);
  let bestIndex = 0;
  let bestScore = 0;

  for (let index = 0; index < limit; index += 1) {
    const cells = matrix[index].map(cellText);
    const score = needles.filter((needle) => cells.some((cell) => cell.includes(needle))).length;

    // Strictly greater, so the earliest of equally good rows wins.
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestScore === 0) {
    throw new Error(
      `Could not find a header row in the first ${limit} row(s): none contained any of ` +
        `${expectedHeaders.map((header) => `"${header}"`).join(', ')}.`,
    );
  }

  return bestIndex;
}

/**
 * True when a cell holds nothing a reader would call a value.
 *
 * Covers the dashes people type into blank cells. `0` is a real number and is
 * never blank — treating it as one is how a genuine zero becomes a gap.
 */
export function isBlankCell(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'string') return false;

  const text = value.trim();
  return text === '' || BLANK_DASHES.has(text);
}

/**
 * Reads a number out of a cell, tolerating the thousands separators a hand-typed
 * sheet carries.
 *
 * Returns `null` — never `0` — when there is no number. A silent zero is a wrong
 * number, and a dash is a blank cell rather than a value.
 */
export function parseNumericCell(value: unknown): number | null {
  if (isBlankCell(value)) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;

  const cleaned = value.replace(NUMERIC_NOISE, '');
  // `Number('')` is 0, so a string of nothing but separators must be caught here.
  if (cleaned === '') return null;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Turns the rows below a header into objects keyed by that header's trimmed
 * column names.
 *
 * Fully-blank rows are dropped — spreadsheets are full of them — which is why
 * each row carries its own `rowNumber` rather than leaving callers to infer one.
 *
 * @throws if `headerRowIndex` falls outside the sheet.
 */
export function sheetRowsFromHeader(sheet: XLSX.WorkSheet, headerRowIndex: number): SheetRow[] {
  const matrix = sheetMatrix(sheet);
  const header = matrix[headerRowIndex];

  if (header === undefined) {
    throw new Error(
      `Header row ${headerRowIndex} is outside the sheet, which has ${matrix.length} row(s).`,
    );
  }

  const keys = header.map((cell) => (isBlankCell(cell) ? null : String(cell).trim()));
  const originRow = sheetOriginRow(sheet);
  const rows: SheetRow[] = [];

  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const cells = matrix[index];
    if (cells.every(isBlankCell)) continue;

    const values: Record<string, unknown> = {};
    keys.forEach((key, column) => {
      if (key !== null) values[key] = cells[column] ?? null;
    });

    rows.push({ rowNumber: originRow + index + 1, values });
  }

  return rows;
}

/** The sheet as a rectangular grid of raw cell values, blank rows included. */
function sheetMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: null,
    raw: true,
  });
}

/**
 * The 0-indexed sheet row the range starts on. `sheet_to_json` drops that offset,
 * so a sheet whose data begins at A3 would otherwise report every row two too
 * early.
 */
function sheetOriginRow(sheet: XLSX.WorkSheet): number {
  const ref = sheet['!ref'];
  return ref === undefined ? 0 : XLSX.utils.decode_range(ref).s.r;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).toLowerCase();
}
