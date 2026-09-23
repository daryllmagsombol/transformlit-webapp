import { ConversionRunner } from './conversion.runner';

describe('ConversionRunner', () => {
  let jobs: { claimNext: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let converter: { convert: jest.Mock };
  let storage: { getBuffer: jest.Mock; deletePrefix: jest.Mock };
  let prisma: { book: { findUnique: jest.Mock }; $transaction: jest.Mock };
  let runner: ConversionRunner;

  const converted = {
    format: 'PDF' as const,
    pageCount: 1,
    pages: [{ index: 1, assetKey: 'a', textKey: 't', mimeType: 'image/png', width: 10, height: 10, itemCount: 1 }],
    toc: [{ title: 'Page 1', page: 1, depth: 0, order: 0 }],
  };

  beforeEach(() => {
    jobs = { claimNext: jest.fn(), complete: jest.fn(), fail: jest.fn() };
    converter = { convert: jest.fn() };
    storage = { getBuffer: jest.fn(), deletePrefix: jest.fn() };
    prisma = { book: { findUnique: jest.fn() }, $transaction: jest.fn() };
    runner = new ConversionRunner(jobs as never, converter as never, storage as never, prisma as never);
  });

  it('returns false when no job is claimable', async () => {
    jobs.claimNext.mockResolvedValue(null);
    expect(await runner.runOnce()).toBe(false);
    expect(converter.convert).not.toHaveBeenCalled();
  });

  it('converts a claimed job and persists pages transactionally', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({
      id: 'book-1',
      blobPath: 'books/book-1/original.pdf',
      format: 'PDF',
      contentVersion: 1,
    });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockResolvedValue(converted);
    const tx = {
      bookPage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookTocEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      book: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    expect(await runner.runOnce()).toBe(true);
    expect(converter.convert).toHaveBeenCalledWith({
      bookId: 'book-1',
      contentVersion: 2,
      buffer: expect.any(Buffer),
    });
    expect(tx.book.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'book-1' },
        data: expect.objectContaining({ conversionStatus: 'READY', pageCount: 1, contentVersion: 2 }),
      }),
    );
    expect(jobs.complete).toHaveBeenCalledWith('job-1');
  });

  it('records a failure when conversion throws', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockRejectedValue(new Error('render exploded'));

    expect(await runner.runOnce()).toBe(true);
    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'render exploded');
    expect(jobs.complete).not.toHaveBeenCalled();
  });
});
