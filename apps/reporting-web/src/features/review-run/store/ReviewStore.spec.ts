import { describe, expect, it, vi } from 'vitest';

import type { ReviewService } from '../service/reviewService';
import { ReviewStore } from './ReviewStore';

function makeStore(overrides: Partial<ReviewService> = {}) {
  const service = {
    createReview: vi.fn(),
    exportReviews: vi.fn(),
    ...overrides,
  } as unknown as ReviewService;
  return { store: new ReviewStore(service), service };
}

describe('exportReviews', () => {
  it('returns the blob and the filename the server named', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' });
    const { store } = makeStore({
      exportReviews: vi.fn().mockResolvedValue({
        blob,
        filename: 'run-reviews-2026-09-10.csv',
      }),
    });

    const result = await store.exportReviews();

    expect(result).toEqual({ blob, filename: 'run-reviews-2026-09-10.csv' });
    expect(store.exportError).toBeNull();
    expect(store.isExportingReviews).toBe(false);
  });

  it('surfaces the API message from a blob error body', async () => {
    // With responseType blob the error envelope arrives as a Blob, not parsed JSON.
    const body = JSON.stringify({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The export is limited to 5000 reviews',
      },
    });
    const { store } = makeStore({
      exportReviews: vi
        .fn()
        .mockRejectedValue({ response: { data: new Blob([body]) } }),
    });

    const result = await store.exportReviews();

    // Null, not a throw: the button must not save a file when the export was rejected.
    expect(result).toBeNull();
    expect(store.exportError).toBe('The export is limited to 5000 reviews');
    expect(store.isExportingReviews).toBe(false);
  });

  it('falls back to the error message when the body is not a JSON envelope', async () => {
    const { store } = makeStore({
      exportReviews: vi.fn().mockRejectedValue(new Error('Network Error')),
    });

    await store.exportReviews();

    expect(store.exportError).toBe('Network Error');
  });

  it('sends no reviewed_from when no date is chosen', async () => {
    const { store, service } = makeStore({
      exportReviews: vi.fn().mockResolvedValue({ blob: new Blob([]), filename: 'x.csv' }),
    });

    await store.exportReviews();

    expect(service.exportReviews).toHaveBeenCalledWith({});
  });

  it('sends the chosen day as the instant of local midnight', async () => {
    const { store, service } = makeStore({
      exportReviews: vi.fn().mockResolvedValue({ blob: new Blob([]), filename: 'x.csv' }),
    });

    store.setExportReviewedFrom('2026-09-14');
    await store.exportReviews();

    expect(service.exportReviews).toHaveBeenCalledWith({
      reviewed_from: new Date(2026, 8, 14, 0, 0, 0).toISOString(),
    });
  });

  it('clears the error so a retry starts clean', async () => {
    const { store } = makeStore({
      exportReviews: vi.fn().mockRejectedValue(new Error('Network Error')),
    });

    await store.exportReviews();
    store.clearExportError();

    expect(store.exportError).toBeNull();
  });
});
