import { ConversionRunner } from './conversion.runner';

describe('ConversionRunner', () => {
  let jobs: { claimNext: jest.Mock; complete: jest.Mock; fail: jest.Mock };
  let converter: { convert: jest.Mock };
  let storage: { getBuffer: jest.Mock; deletePrefix: jest.Mock };
  let prisma: { book: { findUnique: jest.Mock; update: jest.Mock; updateMany: jest.Mock }; $transaction: jest.Mock };
  let runner: ConversionRunner;

  const converted = {
    format: 'PDF' as const,
    pageCount: 1,
    pages: [
      {
        index: 1,
        assetKey: 'books/book-1/v2/pages/1.png',
        textKey: 'books/book-1/v2/pages/1.json',
        mimeType: 'image/png',
        width: 10,
        height: 10,
        itemCount: 1,
        frameByteLength: 8,
        frameSha256: 'a'.repeat(64),
        textByteLength: 12,
        textSha256: 'b'.repeat(64),
        charCount: 5,
        hasTextLayer: true,
      },
    ],
    toc: [{ title: 'Page 1', page: 1, depth: 0, order: 0 }],
  };

  beforeEach(() => {
    jobs = { claimNext: jest.fn(), complete: jest.fn(), fail: jest.fn() };
    converter = { convert: jest.fn() };
    storage = { getBuffer: jest.fn(), deletePrefix: jest.fn() };
    prisma = { book: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() }, $transaction: jest.fn() };
    runner = new ConversionRunner(jobs as never, converter as never, storage as never, prisma as never);
  });

  it('returns false when no job is claimable', async () => {
    jobs.claimNext.mockResolvedValue(null);
    expect(await runner.runOnce()).toBe(false);
    expect(converter.convert).not.toHaveBeenCalled();
  });

  it('atomically allocates the content version before rendering and persists it in one transaction', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({
      id: 'book-1',
      title: 'Book One',
      author: 'Author',
      description: 'Desc',
      blobPath: 'books/book-1/original.pdf',
      format: 'PDF',
      contentVersion: 1,
    });
    prisma.book.update.mockResolvedValue({ contentVersion: 2 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockResolvedValue(converted);
    const tx = {
      bookPage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookTocEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookContentVersion: { create: jest.fn().mockResolvedValue({ id: 'cv-2' }) },
      book: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    expect(await runner.runOnce()).toBe(true);
    // The version is reserved atomically before the long render, so two
    // concurrent jobs can never share a version (and its asset prefix).
    expect(prisma.book.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: { contentVersion: { increment: 1 } },
      select: { contentVersion: true },
    });
    expect(converter.convert).toHaveBeenCalledWith({
      bookId: 'book-1',
      contentVersion: 2,
      buffer: expect.any(Buffer),
    });
    expect(tx.bookContentVersion.create).toHaveBeenCalledTimes(1);
    const versionData = tx.bookContentVersion.create.mock.calls[0][0].data;
    expect(versionData).toMatchObject({
      bookId: 'book-1',
      contentVersion: 2,
      title: 'Book One',
      pageCount: 1,
      eligible: true,
    });
    expect(versionData.pages.create[0]).toMatchObject({
      frameSha256: 'a'.repeat(64),
      textSha256: 'b'.repeat(64),
      hasTextLayer: true,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The projection swap is gated on this job still owning the pointer; the
    // reservation itself was written above and is not rewritten here.
    expect(tx.book.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'book-1', contentVersion: 2 },
        data: expect.objectContaining({ conversionStatus: 'READY', pageCount: 1 }),
      }),
    );
    expect(tx.book.updateMany.mock.calls[0][0].data).not.toHaveProperty('contentVersion');
    expect(jobs.complete).toHaveBeenCalledWith('job-1');
  });

  it('does not swap the shared projection when a newer conversion already owns the pointer', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', title: 'T', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    prisma.book.update.mockResolvedValue({ contentVersion: 2 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockResolvedValue(converted);
    const tx = {
      bookPage: { deleteMany: jest.fn(), createMany: jest.fn() },
      bookTocEntry: { deleteMany: jest.fn(), createMany: jest.fn() },
      bookContentVersion: { create: jest.fn().mockResolvedValue({ id: 'cv-2' }) },
      book: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    await runner.runOnce();
    // A newer job advanced the pointer first; this job keeps its own immutable
    // version but must not clobber the newer shared page/toc projection.
    expect(tx.bookPage.deleteMany).not.toHaveBeenCalled();
    expect(tx.bookPage.createMany).not.toHaveBeenCalled();
    expect(tx.bookContentVersion.create).toHaveBeenCalledTimes(1);
  });

  it('never eagerly deletes the previous version asset prefix', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    prisma.book.update.mockResolvedValue({ contentVersion: 2 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockResolvedValue(converted);
    const tx = {
      bookPage: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookTocEntry: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      bookContentVersion: { create: jest.fn().mockResolvedValue({ id: 'cv-2' }) },
      book: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));

    await runner.runOnce();
    expect(storage.deletePrefix).not.toHaveBeenCalled();
  });

  it('releases an unused reservation when rendering fails so a retry can reuse the version', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    prisma.book.update.mockResolvedValue({ contentVersion: 2 });
    prisma.book.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockRejectedValue(new Error('render exploded'));

    expect(await runner.runOnce()).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Guarded by the current value so a concurrent successful allocation is
    // never decremented out from under the committed pointer.
    expect(prisma.book.updateMany).toHaveBeenCalledWith({
      where: { id: 'book-1', contentVersion: 2 },
      data: { contentVersion: { decrement: 1 } },
    });
    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'render exploded');
  });

  it('records a failure when conversion throws', async () => {
    jobs.claimNext.mockResolvedValue({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    prisma.book.findUnique.mockResolvedValue({ id: 'book-1', blobPath: 'x', format: 'PDF', contentVersion: 1 });
    prisma.book.update.mockResolvedValue({ contentVersion: 2 });
    storage.getBuffer.mockResolvedValue(Buffer.from('%PDF-1.4'));
    converter.convert.mockRejectedValue(new Error('render exploded'));

    expect(await runner.runOnce()).toBe(true);
    expect(jobs.fail).toHaveBeenCalledWith('job-1', 'render exploded');
    expect(jobs.complete).not.toHaveBeenCalled();
  });
});
