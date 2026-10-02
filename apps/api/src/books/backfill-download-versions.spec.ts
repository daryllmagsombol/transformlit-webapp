import { Logger } from '@nestjs/common';

/**
 * The entrypoint is a side-effecting script (`backfill()` runs on import), so
 * this spec executes it once with a real environment and a mocked Nest graph.
 * A separate spec covers the missing-DATABASE_URL refusal.
 */
const mockBackfillAllIneligible = jest.fn();
const mockAppClose = jest.fn();
const mockAppGet = jest.fn();

jest.mock('@nestjs/core', () => ({
  NestFactory: {
    createApplicationContext: jest.fn(async () => ({ get: mockAppGet, close: mockAppClose })),
  },
}));
jest.mock('./book-download-backfill.module.js', () => ({ BookDownloadBackfillModule: class MockBackfillModule {} }));
jest.mock('./book-download.service.js', () => ({ BookDownloadService: class MockBookDownloadService {} }));

import { NestFactory } from '@nestjs/core';
import { BookDownloadService } from './book-download.service.js';

/** Let the fire-and-forget `backfill()` promise chain settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('backfill-download-versions entrypoint', () => {
  const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://backfill-spec';
    // A positional batch-size argument is picked up from process.argv.
    process.argv = ['node', 'backfill-download-versions', '250'];
    mockAppGet.mockReturnValue({ backfillAllIneligible: mockBackfillAllIneligible });
    mockBackfillAllIneligible.mockResolvedValue({
      examined: 87,
      promoted: [{ bookId: 'book-1', contentVersion: 2 }],
      skipped: [
        { bookId: 'book-2', contentVersion: 1 },
        { bookId: 'book-3', contentVersion: 4 },
      ],
    });
    mockAppClose.mockResolvedValue(undefined);

    await import('./backfill-download-versions.js');
    await settle();
  });

  afterAll(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    delete process.env.DATABASE_URL;
  });

  it('runs the backfill with the positional batch size and reports the summary', () => {
    expect(NestFactory.createApplicationContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ logger: ['error', 'warn', 'log'] }),
    );
    expect(mockAppGet).toHaveBeenCalledWith(BookDownloadService);
    expect(mockBackfillAllIneligible).toHaveBeenCalledWith(250);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('examined=87 promoted=1 skipped=2'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('bookId=book-2 contentVersion=1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipped versions remain ineligible'));
  });

  it('closes the application context after a run', () => {
    expect(mockAppClose).toHaveBeenCalledTimes(1);
  });
});
