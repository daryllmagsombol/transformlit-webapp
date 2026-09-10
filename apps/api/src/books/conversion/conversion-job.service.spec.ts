import { ConversionJobService } from './conversion-job.service';

describe('ConversionJobService', () => {
  let prisma: {
    $queryRaw: jest.Mock;
    bookConversionJob: { update: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    book: { update: jest.Mock };
  };
  let service: ConversionJobService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      bookConversionJob: { update: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
      book: { update: jest.fn() },
    };
    service = new ConversionJobService(prisma as never);
  });

  it('enqueues a pending job', async () => {
    prisma.bookConversionJob.create.mockResolvedValue({ id: 'job-1' });
    await service.enqueue('book-1');
    expect(prisma.bookConversionJob.create).toHaveBeenCalledWith({ data: { bookId: 'book-1', status: 'PENDING' } });
  });

  it('claims the next job with SKIP LOCKED', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: 'job-1', bookId: 'book-1', attempts: 0 }]);
    const claimed = await service.claimNext();
    expect(claimed).toEqual({ id: 'job-1', bookId: 'book-1', attempts: 0 });
    const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join(' ');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('book_conversion_jobs');
  });

  it('returns null when nothing is claimable', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await service.claimNext()).toBeNull();
  });

  it('marks a job complete', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({});
    await service.complete('job-1');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'READY', lockedAt: null, lastError: null },
    });
  });

  it('requeues a failed job below the attempt cap', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({ attempts: 1, bookId: 'book-1' });
    await service.fail('job-1', 'boom');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'PENDING', lockedAt: null, lastError: 'boom', attempts: { increment: 1 } },
    });
    expect(prisma.book.update).not.toHaveBeenCalled();
  });

  it('fails the book permanently after the attempt cap', async () => {
    prisma.bookConversionJob.update.mockResolvedValue({ attempts: 3, bookId: 'book-1' });
    await service.fail('job-1', 'boom');
    expect(prisma.bookConversionJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', lockedAt: null, lastError: 'boom', attempts: { increment: 1 } },
    });
    expect(prisma.book.update).toHaveBeenCalledWith({
      where: { id: 'book-1' },
      data: { conversionStatus: 'FAILED', conversionError: 'boom' },
    });
  });

  it('requeues stale processing jobs', async () => {
    prisma.bookConversionJob.updateMany.mockResolvedValue({ count: 2 });
    const count = await service.requeueStale(15 * 60 * 1000);
    expect(count).toBe(2);
    expect(prisma.bookConversionJob.updateMany).toHaveBeenCalled();
  });
});
