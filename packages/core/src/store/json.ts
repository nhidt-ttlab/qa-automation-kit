/**
 * Defensive JSON encoding for a nullable `JSON CHECK (json_valid(...))` SQLite column. Never throws:
 * an unserializable value (e.g. a circular reference) or an absent one both become SQL NULL rather
 * than aborting the whole run-persistence transaction.
 */
export function toJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/** Same as `toJsonColumn`, but an empty array/object becomes `null` rather than a hollow `[]`/`{}`. */
export function toJsonColumnOmitEmpty(value: unknown): string | null {
  if (Array.isArray(value) && value.length === 0) return null;
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return null;
  return toJsonColumn(value);
}

/** Inverse of `toJsonColumn`. Never throws: NULL or an unparseable value both become `undefined`. */
export function parseJsonColumn<T = unknown>(value: string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
