import type { Response } from 'express';
import { RunsController } from './runs.controller';
import type { RunsService } from './runs.service';

function makeResponse() {
  const redirect = jest.fn();
  const set = jest.fn();
  const res = { redirect, set } as unknown as Response;
  return { res, redirect, set };
}

describe('RunsController.downloadArtifact', () => {
  it('redirects when the service resolves an externalUrl-backed artifact', async () => {
    const runsService = {
      getArtifactDownload: jest
        .fn()
        .mockResolvedValue({ kind: 'redirect', url: 'https://example.com/x' }),
    } as unknown as RunsService;
    const controller = new RunsController(runsService);
    const { res, redirect, set } = makeResponse();

    await controller.downloadArtifact('run-1', 3, res);

    expect(redirect).toHaveBeenCalledWith(302, 'https://example.com/x');
    expect(set).not.toHaveBeenCalled();
  });

  it('sets headers and pipes the stream when the service resolves a file/blob-backed artifact', async () => {
    const pipe = jest.fn();
    const stream = { pipe } as unknown as NodeJS.ReadableStream;
    const runsService = {
      getArtifactDownload: jest.fn().mockResolvedValue({
        kind: 'stream',
        stream,
        contentType: 'application/json',
        contentLength: 42,
        filename: 'trace.json',
      }),
    } as unknown as RunsService;
    const controller = new RunsController(runsService);
    const { res, redirect, set } = makeResponse();

    await controller.downloadArtifact('run-1', 3, res);

    expect(set).toHaveBeenCalledWith({
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="trace.json"',
      'Content-Length': '42',
    });
    expect(pipe).toHaveBeenCalledWith(res);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('sanitizes the filename before setting Content-Disposition', async () => {
    const stream = { pipe: jest.fn() } as unknown as NodeJS.ReadableStream;
    const runsService = {
      getArtifactDownload: jest.fn().mockResolvedValue({
        kind: 'stream',
        stream,
        contentType: 'text/plain',
        filename: 'evil"\r\nname.txt',
      }),
    } as unknown as RunsService;
    const controller = new RunsController(runsService);
    const { res, set } = makeResponse();

    await controller.downloadArtifact('run-1', 3, res);

    expect(set).toHaveBeenCalledWith({
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="evilname.txt"',
    });
  });
});

describe('RunsController.getUiEvidenceFile', () => {
  function makeService(result: unknown) {
    return {
      getUiEvidenceFile: jest.fn().mockResolvedValue(result),
    } as unknown as RunsService;
  }

  function streamResult(overrides: Record<string, unknown> = {}) {
    return {
      kind: 'stream',
      stream: { pipe: jest.fn() } as unknown as NodeJS.ReadableStream,
      contentType: 'image/png',
      contentLength: 1024,
      filename: 'S01-login-page.png',
      ...overrides,
    };
  }

  it('serves a screenshot inline so it can render in an <img>', async () => {
    // The artifact route forces `attachment`; doing that here would stop the gallery from
    // showing anything at all.
    const controller = new RunsController(makeService(streamResult()));
    const { res, set } = makeResponse();

    await controller.getUiEvidenceFile('run-1', 'E-UI-01', res);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Type': 'image/png',
        'Content-Disposition': 'inline; filename="S01-login-page.png"',
      }),
    );
  });

  it('serves video inline too', async () => {
    const controller = new RunsController(
      makeService(
        streamResult({ contentType: 'video/webm', filename: 'page@abc.webm' }),
      ),
    );
    const { res, set } = makeResponse();

    await controller.getUiEvidenceFile('run-1', 'E-UI-04', res);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'inline; filename="page@abc.webm"',
      }),
    );
  });

  it('offers a trace zip as a download', async () => {
    const controller = new RunsController(
      makeService(
        streamResult({ contentType: 'application/zip', filename: 'trace.zip' }),
      ),
    );
    const { res, set } = makeResponse();

    await controller.getUiEvidenceFile('run-1', 'E-UI-02', res);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Content-Disposition': 'attachment; filename="trace.zip"',
      }),
    );
  });

  it('marks the response immutably cacheable', async () => {
    // A run directory is written once by the runner and never mutated afterwards.
    const controller = new RunsController(makeService(streamResult()));
    const { res, set } = makeResponse();

    await controller.getUiEvidenceFile('run-1', 'E-UI-01', res);

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        'Cache-Control': 'private, max-age=31536000, immutable',
      }),
    );
  });

  it('propagates the service error for an unknown item id', async () => {
    const runsService = {
      getUiEvidenceFile: jest.fn().mockRejectedValue(new Error('not found')),
    } as unknown as RunsService;
    const controller = new RunsController(runsService);
    const { res, set } = makeResponse();

    await expect(
      controller.getUiEvidenceFile('run-1', 'E-UI-99', res),
    ).rejects.toThrow('not found');
    expect(set).not.toHaveBeenCalled();
  });
});
