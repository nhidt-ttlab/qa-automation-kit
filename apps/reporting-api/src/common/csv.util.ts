/**
 * CSV encoding primitives, shared by every export in this API.
 *
 * Pure: no Nest, no Prisma, no filesystem, no clock. They live here rather than beside one
 * exporter so a cell can never mean two different things depending on which endpoint wrote it.
 */

/**
 * Excel and LibreOffice treat a cell starting with =, +, - or @ as a formula, so pasted text
 * from a comment could execute on the machine of whoever opens the export. Prefixing with an
 * apostrophe is the standard neutralisation: the cell still reads as the original text, but is
 * no longer a formula.
 *
 * Tab and carriage return are included because both are also treated as formula lead-ins once
 * the surrounding quotes are stripped.
 */
function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** RFC 4180: quote when the value contains a delimiter, quote or newline; double inner quotes. */
export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = typeof value === 'string' ? value : String(value);
  if (raw === '') return '';
  const safe = neutralizeFormula(raw);
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

/**
 * Rows to a CSV document.
 *
 * CRLF line endings per RFC 4180, and a UTF-8 BOM by default: without it Excel on Windows reads
 * the file as the system codepage and every Vietnamese character turns to mojibake, which is
 * exactly the content these exports exist to carry.
 */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options: { bom?: boolean } = {},
): string {
  const body = rows
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\r\n');
  const withNewline = rows.length > 0 ? `${body}\r\n` : '';
  return options.bom === false ? withNewline : `\uFEFF${withNewline}`;
}
