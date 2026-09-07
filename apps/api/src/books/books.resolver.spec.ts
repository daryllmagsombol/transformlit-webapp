/// <reference types="jest" />
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { MAX_FILE_SIZE_BYTES } from '@transformlit/shared';
import { BooksResolver } from './books.resolver';
import { BooksService } from './books.service';

const mockBook = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Test Author',
  description: 'A test book',
  coverUrl: null,
  blobPath: null,
  status: 'DRAFT',
  createdById: 'user-1',
  publishedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
};

const mockProgress = {
  id: 'progress-1',
  userId: 'user-1',
  bookId: 'book-1',
  currentPage: 42,
  scrollY: 0,
  lastReadAt: new Date('2024-01-01'),
};

const mockBookmark = {
  id: 'bm-1',
  userId: 'user-1',
  bookId: 'book-1',
  page: 10,
  note: null,
  createdAt: new Date('2024-01-01'),
};

const mockHighlight = {
  id: 'hl-1',
  userId: 'user-1',
  bookId: 'book-1',
  page: 5,
  text: 'some highlighted text',
  color: 'yellow',
  createdAt: new Date('2024-01-01'),
};

const mockUser = { id: 'user-1', role: 'MEMBER' };

describe('BooksResolver', () => {
  let resolver: BooksResolver;
  let booksService: Record<string, jest.Mock>;

  beforeEach(async () => {
    const mockBooksService = {
      listBooks: jest.fn().mockResolvedValue([mockBook]),
      findById: jest.fn().mockResolvedValue(mockBook),
      uploadBook: jest.fn().mockResolvedValue(mockBook),
      updateBook: jest.fn().mockResolvedValue({ ...mockBook, title: 'Updated' }),
      uploadPdf: jest.fn().mockResolvedValue({ ...mockBook, status: 'PUBLISHED' }),
      deleteBook: jest.fn().mockResolvedValue(undefined),
      getProgress: jest.fn().mockResolvedValue(mockProgress),
      saveProgress: jest.fn().mockResolvedValue(mockProgress),
      listBookmarks: jest.fn().mockResolvedValue([mockBookmark]),
      addBookmark: jest.fn().mockResolvedValue(mockBookmark),
      removeBookmark: jest.fn().mockResolvedValue(undefined),
      listHighlights: jest.fn().mockResolvedValue([mockHighlight]),
      addHighlight: jest.fn().mockResolvedValue(mockHighlight),
      removeHighlight: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksResolver,
        { provide: BooksService, useValue: mockBooksService },
      ],
    }).compile();

    resolver = module.get<BooksResolver>(BooksResolver);
    booksService = module.get(BooksService) as any;
    jest.clearAllMocks();
  });

  // ── books query ─────────────────────────────────────────────────────────────

  describe('books', () => {
    it('should delegate to listBooks', async () => {
      const result = await resolver.books();
      expect(booksService.listBooks).toHaveBeenCalledWith();
      expect(result).toEqual([mockBook]);
    });
  });

  // ── book query ──────────────────────────────────────────────────────────────

  describe('book', () => {
    it('should delegate to findById', async () => {
      const result = await resolver.book('book-1');
      expect(booksService.findById).toHaveBeenCalledWith('book-1');
      expect(result).toEqual(mockBook);
    });
  });

  // ── readProgress query ─────────────────────────────────────────────────────

  describe('readProgress', () => {
    it('should delegate to getProgress with user id and bookId', async () => {
      const result = await resolver.readProgress(mockUser, 'book-1');
      expect(booksService.getProgress).toHaveBeenCalledWith('user-1', 'book-1');
      expect(result).toEqual(mockProgress);
    });
  });

  // ── bookmarks query ────────────────────────────────────────────────────────

  describe('bookmarks', () => {
    it('should delegate to listBookmarks with user id and bookId', async () => {
      const result = await resolver.bookmarks(mockUser, 'book-1');
      expect(booksService.listBookmarks).toHaveBeenCalledWith('user-1', 'book-1');
      expect(result).toEqual([mockBookmark]);
    });
  });

  // ── highlights query ───────────────────────────────────────────────────────

  describe('highlights', () => {
    it('should delegate to listHighlights with user id and bookId', async () => {
      const result = await resolver.highlights(mockUser, 'book-1');
      expect(booksService.listHighlights).toHaveBeenCalledWith('user-1', 'book-1');
      expect(result).toEqual([mockHighlight]);
    });
  });

  // ── uploadBook mutation ────────────────────────────────────────────────────

  describe('uploadBook', () => {
    it('should delegate to uploadBook with input and user id', async () => {
      const input = { title: 'Test Book', author: 'Test Author', description: 'A test book' };
      const result = await resolver.uploadBook(mockUser, input as any);
      expect(booksService.uploadBook).toHaveBeenCalledWith(input, 'user-1');
      expect(result).toEqual(mockBook);
    });
  });

  // ── updateBook mutation ────────────────────────────────────────────────────

  describe('updateBook', () => {
    it('should delegate to updateBook with id, input, and user', async () => {
      const input = { title: 'Updated' };
      const result = await resolver.updateBook(mockUser as any, 'book-1', input as any);
      expect(booksService.updateBook).toHaveBeenCalledWith('book-1', input, 'user-1', 'MEMBER');
      expect(result).toEqual({ ...mockBook, title: 'Updated' });
    });
  });

  // ── deleteBook mutation ────────────────────────────────────────────────────

  describe('deleteBook', () => {
    it('should delegate to deleteBook and return true', async () => {
      const result = await resolver.deleteBook(mockUser as any, 'book-1');
      expect(booksService.deleteBook).toHaveBeenCalledWith('book-1', 'user-1', 'MEMBER');
      expect(result).toBe(true);
    });
  });

  // ── uploadPdf mutation ────────────────────────────────────────────────────

  describe('uploadPdf', () => {
    const makeFile = (content: Buffer) => ({
      createReadStream: () => {
        const { Readable } = require('stream');
        return Readable.from([content]);
      },
    });

    it('should delegate to uploadPdf with buffered content and user', async () => {
      const pdfContent = Buffer.from('%PDF-1.7 fake');
      const result = await resolver.uploadPdf(
        mockUser as any,
        'book-1',
        makeFile(pdfContent) as any,
      );
      expect(booksService.uploadPdf).toHaveBeenCalledWith(
        'book-1',
        pdfContent,
        '',
        'user-1',
        'MEMBER',
      );
      expect(result).toEqual({ ...mockBook, status: 'PUBLISHED' });
    });

    it('should reject when streamed content exceeds the size cap', async () => {
      const oversized = Buffer.concat([
        Buffer.from('%PDF-'),
        Buffer.alloc(MAX_FILE_SIZE_BYTES + 1),
      ]);
      await expect(
        resolver.uploadPdf(mockUser as any, 'book-1', makeFile(oversized) as any),
      ).rejects.toThrow(BadRequestException);
      expect(booksService.uploadPdf).not.toHaveBeenCalled();
    });
  });

  // ── saveProgress mutation ──────────────────────────────────────────────────

  describe('saveProgress', () => {
    it('should delegate to saveProgress with user id and input', async () => {
      const input = { bookId: 'book-1', currentPage: 42, scrollY: 0 };
      const result = await resolver.saveProgress(mockUser, input as any);
      expect(booksService.saveProgress).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(mockProgress);
    });
  });

  // ── addBookmark mutation ───────────────────────────────────────────────────

  describe('addBookmark', () => {
    it('should delegate to addBookmark with user id and input', async () => {
      const input = { bookId: 'book-1', page: 10 };
      const result = await resolver.addBookmark(mockUser, input as any);
      expect(booksService.addBookmark).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(mockBookmark);
    });
  });

  // ── removeBookmark mutation ────────────────────────────────────────────────

  describe('removeBookmark', () => {
    it('should delegate to removeBookmark with id and user', async () => {
      const result = await resolver.removeBookmark(mockUser as any, 'bm-1');
      expect(booksService.removeBookmark).toHaveBeenCalledWith('bm-1', 'user-1');
      expect(result).toBe(true);
    });
  });

  // ── addHighlight mutation ──────────────────────────────────────────────────

  describe('addHighlight', () => {
    it('should delegate to addHighlight with user id and input', async () => {
      const input = { bookId: 'book-1', page: 5, text: 'some highlighted text', color: 'yellow' };
      const result = await resolver.addHighlight(mockUser, input as any);
      expect(booksService.addHighlight).toHaveBeenCalledWith('user-1', input);
      expect(result).toEqual(mockHighlight);
    });
  });

  // ── removeHighlight mutation ───────────────────────────────────────────────

  describe('removeHighlight', () => {
    it('should delegate to removeHighlight with id and user', async () => {
      const result = await resolver.removeHighlight(mockUser as any, 'hl-1');
      expect(booksService.removeHighlight).toHaveBeenCalledWith('hl-1', 'user-1');
      expect(result).toBe(true);
    });
  });
});
