/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BooksService } from './books.service';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../azure/blob.service';
import { BookAccessLevel } from '@transformlit/shared';

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

  beforeEach(async () => {
    const mockPrisma = {
      book: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(mockBook),
        create: jest.fn().mockResolvedValue(mockBook),
        update: jest.fn().mockResolvedValue(mockBook),
      },
      bookProgress: {
        findUnique: jest.fn().mockResolvedValue(mockProgress),
        upsert: jest.fn().mockResolvedValue(mockProgress),
      },
      bookmark: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(mockBookmark),
        delete: jest.fn().mockResolvedValue(mockBookmark),
      },
      highlight: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(mockHighlight),
        delete: jest.fn().mockResolvedValue(mockHighlight),
      },
    };

    const mockBlob = {
      uploadPdf: jest.fn().mockResolvedValue('https://blob/book-1/test.pdf'),
      streamPdf: jest.fn().mockResolvedValue({ pipe: jest.fn() }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BlobService, useValue: mockBlob },
      ],
    }).compile();

    service = module.get<BooksService>(BooksService);
    prisma = module.get(PrismaService);
    blob = module.get(BlobService);
    jest.clearAllMocks();

    prisma.book.findMany.mockResolvedValue([]);
    prisma.book.findUnique.mockResolvedValue(mockBook);
    prisma.book.create.mockResolvedValue(mockBook);
    prisma.book.update.mockResolvedValue(mockBook);
    prisma.bookProgress.findUnique.mockResolvedValue(mockProgress);
    prisma.bookProgress.upsert.mockResolvedValue(mockProgress);
    prisma.bookmark.findMany.mockResolvedValue([]);
    prisma.bookmark.create.mockResolvedValue(mockBookmark);
    prisma.bookmark.delete.mockResolvedValue(mockBookmark);
    prisma.highlight.findMany.mockResolvedValue([]);
    prisma.highlight.create.mockResolvedValue(mockHighlight);
    prisma.highlight.delete.mockResolvedValue(mockHighlight);
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
      await service.updateBook('book-1', input);
      expect(prisma.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: input,
      });
    });

    it('should return updated book', async () => {
      const updated = { ...mockBook, title: 'Updated Title' };
      prisma.book.update.mockResolvedValue(updated);
      const result = await service.updateBook('book-1', input);
      expect(result).toEqual(updated);
    });
  });

  // ── uploadPdf ──────────────────────────────────────────────────────────────

  describe('uploadPdf', () => {
    const buffer = Buffer.from('pdf-content');
    const filename = 'test.pdf';

    it('should upload to blob at path books/${bookId}/${filename}', async () => {
      await service.uploadPdf('book-1', buffer, filename);
      expect(blob.uploadPdf).toHaveBeenCalledWith(
        'books/book-1/test.pdf',
        buffer,
        'application/pdf',
      );
    });

    it('should update book with blobPath, status PUBLISHED, and publishedAt', async () => {
      await service.uploadPdf('book-1', buffer, filename);
      expect(prisma.book.update).toHaveBeenCalledWith({
        where: { id: 'book-1' },
        data: expect.objectContaining({
          blobPath: 'books/book-1/test.pdf',
          status: 'PUBLISHED',
        }),
      });
    });

    it('should set publishedAt to a Date', async () => {
      await service.uploadPdf('book-1', buffer, filename);
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
      const result = await service.uploadPdf('book-1', buffer, filename);
      expect(result).toEqual(published);
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
    it('should delete bookmark by id', async () => {
      await service.removeBookmark('bookmark-1');
      expect(prisma.bookmark.delete).toHaveBeenCalledWith({
        where: { id: 'bookmark-1' },
      });
    });

    it('should return deleted bookmark', async () => {
      const result = await service.removeBookmark('bookmark-1');
      expect(result).toEqual(mockBookmark);
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
    it('should delete highlight by id', async () => {
      await service.removeHighlight('highlight-1');
      expect(prisma.highlight.delete).toHaveBeenCalledWith({
        where: { id: 'highlight-1' },
      });
    });

    it('should return deleted highlight', async () => {
      const result = await service.removeHighlight('highlight-1');
      expect(result).toEqual(mockHighlight);
    });
  });

  // ── deleteBook ─────────────────────────────────────────────────────────────

  describe('deleteBook', () => {
    it('should soft delete by setting deletedAt', async () => {
      await service.deleteBook('book-1');
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
      const result = await service.deleteBook('book-1');
      expect(result).toEqual(deleted);
    });
  });
});
