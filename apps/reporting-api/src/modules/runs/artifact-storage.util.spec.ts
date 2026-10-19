import * as path from 'path';
import { NotFoundError } from '@qakit/reporting-shared';
import {
  resolveSafeArtifactPath,
  inferContentType,
  sanitizeFilename,
} from './artifact-storage.util';

describe('resolveSafeArtifactPath', () => {
  const root = path.resolve('/tmp/artifact-root');

  it('resolves a path inside the root', () => {
    const resolved = resolveSafeArtifactPath(root, 'outputs/run-1/trace.json');
    expect(resolved).toBe(path.resolve(root, 'outputs/run-1/trace.json'));
  });

  it('rejects relative traversal escaping the root', () => {
    expect(() => resolveSafeArtifactPath(root, '../../etc/passwd')).toThrow(
      NotFoundError,
    );
  });

  it('rejects an absolute path escaping the root', () => {
    const outside =
      process.platform === 'win32'
        ? 'C:\\Windows\\System32\\config'
        : '/etc/passwd';
    expect(() => resolveSafeArtifactPath(root, outside)).toThrow(NotFoundError);
  });

  it('allows the root itself', () => {
    expect(resolveSafeArtifactPath(root, '.')).toBe(root);
  });
});

describe('inferContentType', () => {
  it.each([
    ['report.json', 'application/json'],
    ['notes.md', 'text/markdown'],
    ['page.html', 'text/html'],
    ['plain.txt', 'text/plain'],
    ['run.log', 'text/plain'],
    ['screenshot.png', 'image/png'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['doc.pdf', 'application/pdf'],
    ['bundle.zip', 'application/zip'],
  ])('maps %s to %s', (filename, expected) => {
    expect(inferContentType(filename)).toBe(expected);
  });

  it('defaults to application/octet-stream for unknown extensions', () => {
    expect(inferContentType('artifact.bin')).toBe('application/octet-stream');
  });
});

describe('sanitizeFilename', () => {
  it('strips quotes and newlines', () => {
    expect(sanitizeFilename('evil"\r\nname.json')).toBe('evilname.json');
  });

  it('leaves a normal filename unchanged', () => {
    expect(sanitizeFilename('trace.json')).toBe('trace.json');
  });
});
