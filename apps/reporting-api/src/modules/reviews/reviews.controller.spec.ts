import type { Response } from 'express';

import { ReviewsController } from './reviews.controller';
import type { ReviewsService } from './reviews.service';

function makeResponse() {
  const set = jest.fn();
  const end = jest.fn();
  const res = { set, end } as unknown as Response;
  return { res, set, end };
}

describe('ReviewsController.exportReviews', () => {
  it('serves the CSV as a dated attachment, sized in bytes rather than characters', async () => {
    // Vietnamese text is multi-byte in UTF-8, so a character count would understate
    // Content-Length and truncate the download.
    const csv = '\uFEFFrun_id\r\nrun-1 Thiếu\r\n';
    const reviewsService = {
      exportReviewsCsv: jest
        .fn()
        .mockResolvedValue({ filename: 'run-reviews-2026-09-10T08-30-00Z.csv', csv }),
    } as unknown as ReviewsService;
    const controller = new ReviewsController(reviewsService);
    const { res, set, end } = makeResponse();

    await controller.exportReviews({}, res);

    expect(set).toHaveBeenCalledWith({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition':
        'attachment; filename="run-reviews-2026-09-10T08-30-00Z.csv"',
      'Content-Length': String(Buffer.byteLength(csv, 'utf8')),
    });
    expect(end).toHaveBeenCalledWith(csv);
  });

  it('passes the query through to the service', async () => {
    const reviewsService = {
      exportReviewsCsv: jest
        .fn()
        .mockResolvedValue({ filename: 'run-reviews-2026-09-10T08-30-00Z.csv', csv: '' }),
    } as unknown as ReviewsService;
    const controller = new ReviewsController(reviewsService);
    const { res } = makeResponse();

    await controller.exportReviews(
      { verdict: 'rejected', reviewed_from: '2026-09-13T17:00:00.000Z' },
      res,
    );

    expect(reviewsService.exportReviewsCsv).toHaveBeenCalledWith({
      verdict: 'rejected',
      reviewed_from: '2026-09-13T17:00:00.000Z',
    });
  });
});
