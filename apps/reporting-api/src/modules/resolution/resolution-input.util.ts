import { ValidationError } from '@qakit/reporting-shared';

/**
 * Input hygiene for the free text the Resolution Queue accepts — comments, decisions,
 * resolutions, verification notes, reopen reasons.
 *
 * Text is stored *verbatim* after these checks. It is never HTML-escaped on the way in and never
 * rendered as HTML on the way out: React escapes by default and nothing in this feature uses
 * `dangerouslySetInnerHTML`. Escaping on write would corrupt the many reasons that legitimately
 * contain `<`, `&` and backticks, and would still not be a defence if some future consumer chose
 * to render raw.
 */

// C0/C1 controls except tab, newline and carriage return, plus the Unicode line/paragraph
// separators and the bidi overrides that let text lie about its own reading order.

const DISALLOWED_CONTROL_CHARS = new RegExp(
  '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u2028\u2029\u202A-\u202E\u2066-\u2069]',
);

function assertNoControlChars(field: string, value: string): void {
  if (DISALLOWED_CONTROL_CHARS.test(value)) {
    throw new ValidationError(
      `${field} contains disallowed control characters`,
      { field },
    );
  }
}

/** Required, non-blank, length-capped text. Returns the trimmed value. */
export function requireText(
  field: string,
  value: unknown,
  maxLength: number,
  minLength = 1,
): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} is required`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new ValidationError(
      minLength === 1
        ? `${field} must not be empty`
        : `${field} must be at least ${minLength} characters`,
      { field, minLength },
    );
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `${field} must be at most ${maxLength} characters`,
      {
        field,
        maxLength,
        actual: trimmed.length,
      },
    );
  }
  assertNoControlChars(field, trimmed);
  return trimmed;
}

/**
 * Optional text. `undefined` means "leave alone"; `null` and `''` both mean "clear it", which is
 * how a PATCH removes an owner or a user summary.
 */
export function optionalText(
  field: string,
  value: unknown,
  maxLength: number,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new ValidationError(`${field} must be a string or null`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) {
    throw new ValidationError(
      `${field} must be at most ${maxLength} characters`,
      {
        field,
        maxLength,
        actual: trimmed.length,
      },
    );
  }
  assertNoControlChars(field, trimmed);
  return trimmed;
}

/** Rejects a value outside a closed vocabulary, naming the alternatives. */
export function requireOneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(
      `${field} must be one of: ${allowed.join(', ')}`,
      {
        field,
        allowed,
        received: value,
      },
    );
  }
  return value as T;
}

export function optionalOneOf<T extends string>(
  field: string,
  value: unknown,
  allowed: readonly T[],
): T | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return requireOneOf(field, value, allowed);
}
