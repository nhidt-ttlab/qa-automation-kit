/**
 * Saves a fetched blob to the user's disk.
 *
 * Kept out of the stores on purpose: this is the one part of a download that needs the DOM, and
 * isolating it means the stores stay testable in a plain environment while this stays a four-line
 * function with nothing to get wrong.
 *
 * The object URL is revoked afterwards; without that, every export would hold its whole CSV in
 * memory until the tab closed.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // Firefox only honours a click on an element that is in the document.
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
