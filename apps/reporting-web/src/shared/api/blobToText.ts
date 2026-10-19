/**
 * Reads a Blob as UTF-8 text.
 *
 * Uses `FileReader` rather than `Blob.text()` deliberately. `Blob.text()` is shorter, but it does
 * not exist in jsdom, so the branch that would run in production could never be exercised by a
 * test — and a feature-detected fallback would leave the *tested* path being the one browsers
 * never take. `FileReader` is one path everywhere, and it is what the tests actually run.
 */
export function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the response body'));
    reader.readAsText(blob);
  });
}
