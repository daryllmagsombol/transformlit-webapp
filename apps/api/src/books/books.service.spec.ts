/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BooksService } from './books.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../azure/blob.service';
import { STORAGE_ADAPTER } from '../storage/storage-adapter';
import { ConversionJobService } from './conversion/conversion-job.service';
import { buildTestPdf } from '../../test/fixtures/build-pdf';
import { BookAccessLevel, UserRole } from '@transformlit/shared';

const mockBook = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Author',
  description: 'Desc',
  coverUrl: null,
  price: null,
  currency: null,
  accessLevel: 'FREE',
  status: 'DRAFT',
  totalPages: null,
  blobPath: null,
  publishedAt: null,
  deletedAt: null,
  createdById: 'user-1',
  createdAt: new Date('2024-01-01'),
};

const mockProgress = {
  userId: 'user-1',
  bookId: 'book-1',
  currentPage: 10,
  scrollY: 200,
  completedAt: null,
  lastReadAt: new Date('2024-01-15'),
};

const mockBookmark = {
  id: 'bookmark-1',
  userId: 'user-1',
  bookId: 'book-1',
  page: 5,
  label: 'Important',
  color: '#ff0',
  createdAt: new Date('2024-01-10'),
};

const mockHighlight = {
  id: 'highlight-1',
  userId: 'user-1',
  bookId: 'book-1',
  page: 3,
  text: 'Some highlighted text',
  note: 'My note',
  color: '#ff0',
  createdAt: new Date('2024-01-10'),
};

describe('BooksService', () => {
  let service: BooksService;
  let prisma: any;
  let blob: any;
  let storage: any;
  let jobs: any;

  beforeEach(async () => {
    const mockPrisma = {
      book: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockBook),
        create: jest.fn().mockResolvedValue(mockBook),
        update: jest.fn().mockResolvedValue(mockBook),
      },
      bookAccess: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      bookProgress: {
        findUnique: jest.fn().mockResolvedValue(mockProgress),
        upsert: jest.fn().mockResolvedValue(mockProgress),
      },
      bookmark: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(mockBookmark),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      highlight: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(mockHighlight),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    const mockBlob = {
      uploadPdf: jest.fn().mockResolvedValue('https://blob/book-1/test.pdf'),
      streamPdf: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
    };

    const mockStorage = {
      put: jest.fn().mockResolvedValue(undefined),
    };

    const mockJobs = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BlobService, useValue: mockBlob },
        { provide: STORAGE_ADAPTER, useValue: mockStorage },
        { provide: ConversionJobService, useValue: mockJobs },
      ],
    }).compile();

    service = module.get<BooksService>(BooksService);
    prisma = module.get(PrismaService);
    blob = module.get(BlobService);
    storage = module.get(STORAGE_ADAPTER);
    jobs = module.get(ConversionJobService);
    jest.clearAllMocks();

    prisma.book.findMany.mockResolvedValue([]);
    prisma.book.findUnique.mockResolvedValue(mockBook);
    prisma.book.create.mockResolvedValue(mockBook);
    prisma.book.update.mockResolvedValue(mockBook);
    prisma.bookAccess.findUnique.mockResolvedValue(null);
    prisma.bookProgress.findUnique.mockResolvedValue(mockProgress);
    prisma.bookProgress.upsert.mockResolvedValue(mockProgress);
    prisma.bookmark.findMany.mockResolvedValue([]);
    prisma.bookmark.create.mockResolvedValue(mockBookmark);
    prisma.bookmark.deleteMany.mockResolvedValue({ count: 1 });
    prisma.highlight.findMany.mockResolvedValue([]);
    prisma.highlight.create.mockResolvedValue(mockHighlight);
    prisma.highlight.deleteMany.mockResolvedValue({ count: 1 });
    blob.uploadPdf.mockResolvedValue('https://blob/book-1/test.pdf');
    blob.streamPdf.mockResolvedValue({ pipe: jest.fn() });
  });

  // ── listBooks ──────────────────────────────────────────────────────────────

  describe('listBooks', () => {
    it('should find non-deleted books', async () => {
      await service.listBooks();
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deletedAt: null },
        }),
      );
    });

    it('should order by createdAt descending', async () => {
      await service.listBooks();
      expect(prisma.book.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('should return books array', async () => {
      const books = [mockBook, { ...mockBook, id: 'book-2' }];
      prisma.book.findMany.mockResolvedValue(books);
      const result = await service.listBooks();
      expect(result).toEqual(books);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('should find book by id where deletedAt is null', async () => {
      await service.findById('book-1');
      expect(prisma.book.findUnique).toHaveBeenCalledWith({
        where: { id: 'book-1', deletedAt: null },
        include: { tocEntries: { orderBy: { order: 'asc' } } },
      });
    });

    it('should return the book if found', async () => {
      const result = await service.findById('book-1');
      expect(result).toEqual(mockBook);
    });

    it('should throw NotFoundException if not found', async () => {
      prisma.book.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException with message "Book not found"', async () => {
      prisma.book.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow('Book not found');
    });
  });

  // ── uploadBook ─────────────────────────────────────────────────────────────

  describe('uploadBook', () => {
    const input = {
      title: 'Test Book',
      author: 'Author',
      description: 'Desc',
      accessLevel: 'FREE' as BookAccessLevel,
    };

    it('should create book with input data and createdById', async () => {
      await service.uploadBook(input, 'user-1');
      expect(prisma.book.create).toHaveBeenCalledWith({
        data: { ...input, createdById: 'user-1' },
      });
    });

    it('should return created book', async () => {
      const result = await service.uploadBook(input, 'user-1');
      expect(result).toEqual(mockBook);
    });
  });

  // ── updateBook ─────────────────────────────────────────────────────────────

  describe('updateBook', () => {
    const input = { title: 'Updated Title' };

    it('should update book with provided fields', async () => {
      await service.updateBook('book-1', input, 'user-1', UserRole.MEMBER);
      expect(prisma.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: input,
      });
    });

    it('should return updated book', async () => {
      const updated = { ...mockBook, title: 'Updated Title' };
      prisma.book.update.mockResolvedValue(updated);
      const result = await service.updateBook('book-1', input, 'user-1', UserRole.MEMBER);
      expect(result).toEqual(updated);
    });

    it('should allow ADMIN to update a book they do not own', async () => {
      const result = await service.updateBook('book-1', input, 'user-2', UserRole.ADMIN);
      expect(result).toEqual(mockBook);
    });

    it('should allow MODERATOR to update a book they do not own', async () => {
      const result = await service.updateBook('book-1', input, 'user-2', UserRole.MODERATOR);
      expect(result).toEqual(mockBook);
    });

    it('should throw ForbiddenException when a non-owner MEMBER updates', async () => {
      await expect(
        service.updateBook('book-1', input, 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when book does not exist', async () => {
      prisma.book.findUnique.mockResolvedValue(null);
      await expect(
        service.updateBook('missing', input, 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── uploadPdf ──────────────────────────────────────────────────────────────

  describe('uploadPdf', () => {
    const buffer = Buffer.from('%PDF-1.7 fake pdf content');
    const filename = 'test.pdf';

    it('should store the original via the storage adapter at books/${bookId}/<uuid>.pdf', async () => {
      await service.uploadPdf('book-1', buffer, filename, 'user-1', UserRole.MEMBER);
      const storageKey = storage.put.mock.calls[0][0];
      expect(storageKey).toMatch(/^books\/book-1\/[0-9a-f-]{36}\.pdf$/);
      expect(storage.put).toHaveBeenCalledWith(
        storageKey,
        buffer,
        'application/pdf',
      );
    });

    it('should update book with blobPath, status PUBLISHED, and publishedAt', async () => {
      await service.uploadPdf('book-1', buffer, filename, 'user-1', UserRole.MEMBER);
      expect(prisma.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: expect.objectContaining({
          blobPath: expect.stringMatching(/^books\/book-1\/.+.pdf$/),
          status: 'PUBLISHED',
        }),
      });
    });

    it('should set publishedAt to a Date', async () => {
      await service.uploadPdf('book-1', buffer, filename, 'user-1', UserRole.MEMBER);
      const call = prisma.book.update.mock.calls[0][0];
      expect(call.data.publishedAt).toBeInstanceOf(Date);
    });

    it('should return updated book', async () => {
      const published = {
        ...mockBook,
        blobPath: 'books/book-1/test.pdf',
        status: 'PUBLISHED',
      };
      prisma.book.update.mockResolvedValue(published);
      const result = await service.uploadPdf('book-1', buffer, filename, 'user-1', UserRole.MEMBER);
      expect(result).toEqual(published);
    });

    it('should throw ForbiddenException when a non-owner MEMBER uploads', async () => {
      await expect(
        service.uploadPdf('book-1', buffer, filename, 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('should reject oversized buffers with BadRequestException', async () => {
      const oversized = Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(50 * 1024 * 1024),
      ]);
      await expect(
        service.uploadPdf('book-1', oversized, filename, 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });

    it('should reject buffers that are not PDFs with BadRequestException', async () => {
      const notPdf = Buffer.from('this is definitely not a pdf');
      await expect(
        service.uploadPdf('book-1', notPdf, filename, 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(BadRequestException);
      expect(storage.put).not.toHaveBeenCalled();
    });
  });

  // ── streamPdf ──────────────────────────────────────────────────────────────

  describe('streamPdf', () => {
    it('should find book by id', async () => {
      prisma.book.findUnique.mockResolvedValue({ ...mockBook, blobPath: 'books/book-1/test.pdf' });
      await service.streamPdf('book-1', 'user-1');
      expect(prisma.book.findUnique).toHaveBeenCalledWith({
        where: { id: 'book-1' },
      });
    });

    it('should throw NotFoundException if book has no blobPath', async () => {
      prisma.book.findUnique.mockResolvedValue({ ...mockBook, blobPath: null });
      await expect(service.streamPdf('book-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if book not found', async () => {
      prisma.book.findUnique.mockResolvedValue(null);
      await expect(service.streamPdf('book-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should return blob.streamPdf(book.blobPath)', async () => {
      const bookWithPdf = { ...mockBook, blobPath: 'books/book-1/test.pdf' };
      prisma.book.findUnique.mockResolvedValue(bookWithPdf);
      const mockStream = { pipe: jest.fn() };
      blob.streamPdf.mockResolvedValue(mockStream);
      const result = await service.streamPdf('book-1', 'user-1');
      expect(blob.streamPdf).toHaveBeenCalledWith('books/book-1/test.pdf');
      expect(result).toEqual(mockStream);
    });

    it('should check bookAccess when book is RESTRICTED and user is not the creator', async () => {
      const restrictedBook = {
        ...mockBook,
        accessLevel: 'RESTRICTED',
        blobPath: 'books/book-1/test.pdf',
      };
      prisma.book.findUnique.mockResolvedValue(restrictedBook);
      prisma.bookAccess.findUnique.mockResolvedValue({ id: 'access-1' });
      const mockStream = { pipe: jest.fn() };
      blob.streamPdf.mockResolvedValue(mockStream);
      await service.streamPdf('book-1', 'user-2');
      expect(prisma.bookAccess.findUnique).toHaveBeenCalledWith({
        where: { bookId_userId: { bookId: 'book-1', userId: 'user-2' } },
      });
    });

    it('should allow streaming when a bookAccess row exists', async () => {
      const restrictedBook = {
        ...mockBook,
        accessLevel: 'RESTRICTED',
        blobPath: 'books/book-1/test.pdf',
      };
      prisma.book.findUnique.mockResolvedValue(restrictedBook);
      prisma.bookAccess.findUnique.mockResolvedValue({ id: 'access-1' });
      const mockStream = { pipe: jest.fn() };
      blob.streamPdf.mockResolvedValue(mockStream);
      const result = await service.streamPdf('book-1', 'user-2');
      expect(result).toEqual(mockStream);
    });

    it('should throw ForbiddenException for RESTRICTED book without access', async () => {
      const restrictedBook = {
        ...mockBook,
        accessLevel: 'RESTRICTED',
        blobPath: 'books/book-1/test.pdf',
      };
      prisma.book.findUnique.mockResolvedValue(restrictedBook);
      prisma.bookAccess.findUnique.mockResolvedValue(null);
      await expect(service.streamPdf('book-1', 'user-2')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should allow the creator to stream a RESTRICTED book', async () => {
      const restrictedBook = {
        ...mockBook,
        accessLevel: 'RESTRICTED',
        blobPath: 'books/book-1/test.pdf',
      };
      prisma.book.findUnique.mockResolvedValue(restrictedBook);
      const mockStream = { pipe: jest.fn() };
      blob.streamPdf.mockResolvedValue(mockStream);
      const result = await service.streamPdf('book-1', 'user-1');
      expect(result).toEqual(mockStream);
      expect(prisma.bookAccess.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── getProgress ────────────────────────────────────────────────────────────

  describe('getProgress', () => {
    it('should find progress by composite key userId_bookId', async () => {
      await service.getProgress('user-1', 'book-1');
      expect(prisma.bookProgress.findUnique).toHaveBeenCalledWith({
        where: { userId_bookId: { userId: 'user-1', bookId: 'book-1' } },
      });
    });

    it('should return progress if found', async () => {
      const result = await service.getProgress('user-1', 'book-1');
      expect(result).toEqual(mockProgress);
    });

    it('should return null if not found', async () => {
      prisma.bookProgress.findUnique.mockResolvedValue(null);
      const result = await service.getProgress('user-1', 'book-1');
      expect(result).toBeNull();
    });
  });

  // ── saveProgress ───────────────────────────────────────────────────────────

  describe('saveProgress', () => {
    const input = { bookId: 'book-1', currentPage: 15, scrollY: 300 };

    it('should upsert on composite key userId_bookId', async () => {
      await service.saveProgress('user-1', input);
      expect(prisma.bookProgress.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_bookId: { userId: 'user-1', bookId: 'book-1' } },
        }),
      );
    });

    it('should update with currentPage, scrollY, and lastReadAt', async () => {
      await service.saveProgress('user-1', input);
      const call = prisma.bookProgress.upsert.mock.calls[0][0];
      expect(call.update).toEqual(
        expect.objectContaining({
          currentPage: 15,
          scrollY: 300,
        }),
      );
      expect(call.update.lastReadAt).toBeInstanceOf(Date);
    });

    it('should create with userId, bookId, currentPage, scrollY', async () => {
      await service.saveProgress('user-1', input);
      const call = prisma.bookProgress.upsert.mock.calls[0][0];
      expect(call.create).toEqual(
        expect.objectContaining({
          userId: 'user-1',
          bookId: 'book-1',
          currentPage: 15,
          scrollY: 300,
        }),
      );
    });

    it('should return progress', async () => {
      const result = await service.saveProgress('user-1', input);
      expect(result).toEqual(mockProgress);
    });
  });

  // ── listBookmarks ──────────────────────────────────────────────────────────

  describe('listBookmarks', () => {
    it('should find bookmarks by userId and bookId', async () => {
      await service.listBookmarks('user-1', 'book-1');
      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', bookId: 'book-1' },
        }),
      );
    });

    it('should order by page ascending', async () => {
      await service.listBookmarks('user-1', 'book-1');
      expect(prisma.bookmark.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { page: 'asc' },
        }),
      );
    });

    it('should return bookmarks array', async () => {
      const bookmarks = [mockBookmark];
      prisma.bookmark.findMany.mockResolvedValue(bookmarks);
      const result = await service.listBookmarks('user-1', 'book-1');
      expect(result).toEqual(bookmarks);
    });
  });

  // ── addBookmark ────────────────────────────────────────────────────────────

  describe('addBookmark', () => {
    const input = { bookId: 'book-1', page: 5, label: 'Important', color: '#ff0' };

    it('should create bookmark with userId and input data', async () => {
      await service.addBookmark('user-1', input);
      expect(prisma.bookmark.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', ...input },
      });
    });

    it('should return created bookmark', async () => {
      const result = await service.addBookmark('user-1', input);
      expect(result).toEqual(mockBookmark);
    });
  });

  // ── removeBookmark ─────────────────────────────────────────────────────────

  describe('removeBookmark', () => {
    it('should delete bookmark by id and userId', async () => {
      const result = await service.removeBookmark('bookmark-1', 'user-1');
      expect(prisma.bookmark.deleteMany).toHaveBeenCalledWith({
        where: { id: 'bookmark-1', userId: 'user-1' },
      });
      expect(result).toBe(true);
    });

    it('should throw NotFoundException when bookmark not owned by user', async () => {
      prisma.bookmark.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.removeBookmark('bookmark-1', 'user-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── listHighlights ─────────────────────────────────────────────────────────

  describe('listHighlights', () => {
    it('should find highlights by userId and bookId', async () => {
      await service.listHighlights('user-1', 'book-1');
      expect(prisma.highlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', bookId: 'book-1' },
        }),
      );
    });

    it('should order by page ascending', async () => {
      await service.listHighlights('user-1', 'book-1');
      expect(prisma.highlight.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { page: 'asc' },
        }),
      );
    });

    it('should return highlights array', async () => {
      const highlights = [mockHighlight];
      prisma.highlight.findMany.mockResolvedValue(highlights);
      const result = await service.listHighlights('user-1', 'book-1');
      expect(result).toEqual(highlights);
    });
  });

  // ── addHighlight ───────────────────────────────────────────────────────────

  describe('addHighlight', () => {
    const input = { bookId: 'book-1', page: 3, text: 'Some text', note: 'Note', color: '#ff0' };

    it('should create highlight with userId and input data', async () => {
      await service.addHighlight('user-1', input);
      expect(prisma.highlight.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', ...input },
      });
    });

    it('should return created highlight', async () => {
      const result = await service.addHighlight('user-1', input);
      expect(result).toEqual(mockHighlight);
    });
  });

  // ── removeHighlight ────────────────────────────────────────────────────────

  describe('removeHighlight', () => {
    it('should delete highlight by id and userId', async () => {
      const result = await service.removeHighlight('highlight-1', 'user-1');
      expect(prisma.highlight.deleteMany).toHaveBeenCalledWith({
        where: { id: 'highlight-1', userId: 'user-1' },
      });
      expect(result).toBe(true);
    });

    it('should throw NotFoundException when highlight not owned by user', async () => {
      prisma.highlight.deleteMany.mockResolvedValue({ count: 0 });
      await expect(
        service.removeHighlight('highlight-1', 'user-2'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteBook ─────────────────────────────────────────────────────────────

  describe('deleteBook', () => {
    it('should soft delete by setting deletedAt', async () => {
      await service.deleteBook('book-1', 'user-1', UserRole.MEMBER);
      expect(prisma.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
        }),
      });
    });

    it('should return updated book', async () => {
      const deleted = { ...mockBook, deletedAt: new Date() };
      prisma.book.update.mockResolvedValue(deleted);
      const result = await service.deleteBook('book-1', 'user-1', UserRole.MEMBER);
      expect(result).toEqual(deleted);
    });

    it('should throw ForbiddenException when a non-owner MEMBER deletes', async () => {
      await expect(
        service.deleteBook('book-1', 'user-2', UserRole.MEMBER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.book.update).not.toHaveBeenCalled();
    });

    it('should allow ADMIN to delete a book they do not own', async () => {
      const result = await service.deleteBook('book-1', 'user-2', UserRole.ADMIN);
      expect(result).toEqual(mockBook);
    });

    it('should throw NotFoundException when book does not exist', async () => {
      prisma.book.findUnique.mockResolvedValue(null);
      await expect(
        service.deleteBook('missing', 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── uploadBookFile ─────────────────────────────────────────────────────────

  describe('uploadBookFile', () => {
    it('stores the original, sets format and PENDING, and enqueues conversion', async () => {
      const localPrisma = {
        book: {
          findUnique: jest.fn().mockResolvedValue({ id: 'book-1', createdById: 'user-1' }),
          update: jest.fn().mockResolvedValue({ id: 'book-1', format: 'PDF', conversionStatus: 'PENDING' }),
        },
        bookAccess: { findUnique: jest.fn() },
      };
      const localStorage = { put: jest.fn().mockResolvedValue(undefined) };
      const localJobs = { enqueue: jest.fn().mockResolvedValue(undefined) };
      const localService = new BooksService(
        localPrisma as never,
        { streamPdf: jest.fn(), uploadPdf: jest.fn() } as never,
        localStorage as never,
        localJobs as never,
      );

      const result = await localService.uploadBookFile('book-1', buildTestPdf(['Hello']), 'user-1', UserRole.MEMBER);

      expect(localStorage.put).toHaveBeenCalledWith(
        expect.stringMatching(/^books\/book-1\/[0-9a-f-]+\.pdf$/),
        expect.any(Buffer),
        'application/pdf',
      );
      expect(localJobs.enqueue).toHaveBeenCalledWith('book-1');
      expect(result.format).toBe('PDF');
    });

    it('rejects a non-PDF buffer', async () => {
      const localPrisma = {
        book: { findUnique: jest.fn().mockResolvedValue({ id: 'book-1', createdById: 'user-1' }), update: jest.fn() },
        bookAccess: { findUnique: jest.fn() },
      };
      const localService = new BooksService(
        localPrisma as never,
        {} as never,
        { put: jest.fn() } as never,
        { enqueue: jest.fn() } as never,
      );
      await expect(
        localService.uploadBookFile('book-1', Buffer.from('nope'), 'user-1', UserRole.MEMBER),
      ).rejects.toThrow(/not a PDF or EPUB/);
    });
  });

  // ── assertCanRead ──────────────────────────────────────────────────────────

  describe('assertCanRead', () => {
    const base = { id: 'book-1', deletedAt: null, status: 'PUBLISHED', conversionStatus: 'READY', accessLevel: 'FREE', createdById: null };

    it('allows a free, published, ready book', async () => {
      const localPrisma = { book: { findUnique: jest.fn().mockResolvedValue(base) }, bookAccess: { findUnique: jest.fn() } };
      const localService = new BooksService(localPrisma as never, {} as never, {} as never, {} as never);
      await expect(localService.assertCanRead('book-1', 'user-1')).resolves.toMatchObject({ id: 'book-1' });
    });

    it('rejects a deleted book', async () => {
      const localPrisma = { book: { findUnique: jest.fn().mockResolvedValue({ ...base, deletedAt: new Date() }) }, bookAccess: { findUnique: jest.fn() } };
      const localService = new BooksService(localPrisma as never, {} as never, {} as never, {} as never);
      await expect(localService.assertCanRead('book-1', 'user-1')).rejects.toThrow(/not available/);
    });

    it('rejects a book that is still converting', async () => {
      const localPrisma = { book: { findUnique: jest.fn().mockResolvedValue({ ...base, conversionStatus: 'PENDING' }) }, bookAccess: { findUnique: jest.fn() } };
      const localService = new BooksService(localPrisma as never, {} as never, {} as never, {} as never);
      await expect(localService.assertCanRead('book-1', 'user-1')).rejects.toThrow(/not ready/);
    });

    it('rejects a restricted book without entitlement', async () => {
      const localPrisma = {
        book: { findUnique: jest.fn().mockResolvedValue({ ...base, accessLevel: 'RESTRICTED' }) },
        bookAccess: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      const localService = new BooksService(localPrisma as never, {} as never, {} as never, {} as never);
      await expect(localService.assertCanRead('book-1', 'user-1')).rejects.toThrow(/do not have access/);
    });

    it('allows a restricted book with an access row', async () => {
      const localPrisma = {
        book: { findUnique: jest.fn().mockResolvedValue({ ...base, accessLevel: 'RESTRICTED' }) },
        bookAccess: { findUnique: jest.fn().mockResolvedValue({ id: 'access-1' }) },
      };
      const localService = new BooksService(localPrisma as never, {} as never, {} as never, {} as never);
      await expect(localService.assertCanRead('book-1', 'user-1')).resolves.toMatchObject({ id: 'book-1' });
    });
  });
});
