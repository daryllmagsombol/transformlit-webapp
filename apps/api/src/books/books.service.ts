import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MAX_FILE_SIZE_BYTES, UserRole } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlobService } from '../azure/blob.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';
import {
  UploadBookInput,
  UpdateBookInput,
  SaveProgressInput,
  AddBookmarkInput,
  AddHighlightInput,
} from './models/book.model.js';

/** The Book columns the reader entitlement gate needs. */
export interface ReadableBookFacts {
  id: string;
  deletedAt: Date | null;
  status: string;
  conversionStatus: string;
  accessLevel: string;
  createdById: string | null;
}

@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
  ) {}

  async listBooks() {
    return this.prisma.book.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, _userId?: string) {
    const book = await this.prisma.book.findUnique({
      where: { id, deletedAt: null },
      include: { tocEntries: { orderBy: { order: 'asc' } } },
    });
    if (!book) throw new NotFoundException('Book not found');
    return { ...book, toc: book.tocEntries };
  }

  async listToc(bookId: string) {
    return this.prisma.bookTocEntry.findMany({ where: { bookId }, orderBy: { order: 'asc' } });
  }

  /** Marks a book PENDING again so the worker re-runs conversion. */
  async setConversionPending(bookId: string) {
    await this.prisma.book.update({
      where: { id: bookId },
      data: { conversionStatus: 'PENDING', conversionError: null },
    });
  }

  async uploadBook(input: UploadBookInput, userId: string) {
    return this.prisma.book.create({
      data: { ...input, createdById: userId },
    });
  }

  async updateBook(
    id: string,
    input: UpdateBookInput,
    actorId: string,
    actorRole: UserRole,
  ) {
    await this.assertCanManageBookPublic(id, actorId, actorRole);
    return this.prisma.book.update({ where: { id }, data: input });
  }

  async uploadPdf(
    bookId: string,
    buffer: Buffer,
    _filename: string,
    actorId: string,
    actorRole: UserRole,
  ) {
    return this.uploadBookFile(bookId, buffer, actorId, actorRole);
  }

  /** Detects the format from magic bytes. PDF: %PDF-. EPUB: zip with mimetype entry. */
  detectFormat(buffer: Buffer): 'PDF' | 'EPUB' | null {
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
    const isZip = buffer.subarray(0, 2).toString('latin1') === 'PK';
    const hasEpubMimetype = buffer.subarray(0, 4096).includes(Buffer.from('application/epub+zip'));
    return isZip && hasEpubMimetype ? 'EPUB' : null;
  }

  async uploadBookFile(
    bookId: string,
    buffer: Buffer,
    actorId: string,
    actorRole: UserRole,
  ) {
    await this.assertCanManageBookPublic(bookId, actorId, actorRole);

    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }
    const format = this.detectFormat(buffer);
    if (!format) {
      throw new BadRequestException('Uploaded file is not a PDF or EPUB');
    }

    // Never trust the client-supplied filename; always generate a server-side key.
    const extension = format === 'PDF' ? 'pdf' : 'epub';
    const storageKey = `books/${bookId}/${randomUUID()}.${extension}`;
    await this.storage.put(storageKey, buffer, format === 'PDF' ? 'application/pdf' : 'application/epub+zip');

    // Persist the PENDING book and enqueue its conversion job in a single
    // transaction so a crash can never leave a PENDING book with no job.
    return this.prisma.$transaction(async (tx) => {
      const book = await tx.book.update({
        where: { id: bookId },
        data: {
          blobPath: storageKey,
          format,
          conversionStatus: 'PENDING',
          conversionError: null,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      await tx.bookConversionJob.create({ data: { bookId, status: 'PENDING' } });
      return book;
    });
  }

  async streamPdf(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book?.blobPath) throw new NotFoundException('PDF not available');

    const hasAccess =
      book.accessLevel === 'FREE' ||
      book.createdById === userId ||
      (await this.prisma.bookAccess.findUnique({
        where: { bookId_userId: { bookId, userId } },
      })) !== null;

    if (!hasAccess) throw new ForbiddenException('You do not have access to this book');
    return this.blob.streamPdf(book.blobPath);
  }

  /**
   * Non-throwing reader gate. Returns whether `userId` may read `book`.
   * `assertCanRead` delegates to it, and the GraphQL `toc` resolve field needs
   * a boolean (it must return `[]`, not throw, for unreadable books).
   */
  async canRead(book: ReadableBookFacts, userId: string): Promise<boolean> {
    if (book.deletedAt) return false;
    if (book.status !== 'PUBLISHED') return false;
    if (book.conversionStatus !== 'READY') return false;
    if (book.accessLevel === 'FREE' || book.createdById === userId) return true;

    const access = await this.prisma.bookAccess.findUnique({
      where: { bookId_userId: { bookId: book.id, userId } },
    });
    return access !== null;
  }

  /**
   * Single entitlement gate for every reader request. Throws rather than
   * returning booleans so callers cannot accidentally ignore the result.
   */
  async assertCanRead(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.deletedAt) throw new NotFoundException('Book not available');
    if (book.status !== 'PUBLISHED') throw new ForbiddenException('Book is not published');
    if (book.conversionStatus !== 'READY') throw new ForbiddenException('Book is not ready to read');
    if (!(await this.canRead(book, userId))) throw new ForbiddenException('You do not have access to this book');
    return book;
  }

  async getPageRecord(bookId: string, index: number) {
    return this.prisma.bookPage.findUnique({ where: { bookId_index: { bookId, index } } });
  }

  // Read progress
  async getProgress(userId: string, bookId: string) {
    return this.prisma.bookProgress.findUnique({
      where: { userId_bookId: { userId, bookId } },
    });
  }

  async saveProgress(userId: string, input: SaveProgressInput) {
    return this.prisma.bookProgress.upsert({
      where: { userId_bookId: { userId, bookId: input.bookId } },
      update: { currentPage: input.currentPage, scrollY: input.scrollY ?? undefined, lastReadAt: new Date() },
      create: { userId, bookId: input.bookId, currentPage: input.currentPage, scrollY: input.scrollY ?? undefined },
    });
  }

  // Bookmarks
  async listBookmarks(userId: string, bookId: string) {
    return this.prisma.bookmark.findMany({
      where: { userId, bookId },
      orderBy: { page: 'asc' },
    });
  }

  async addBookmark(userId: string, input: AddBookmarkInput) {
    return this.prisma.bookmark.create({
      data: { userId, ...input },
    });
  }

  async removeBookmark(id: string, userId: string) {
    const result = await this.prisma.bookmark.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) throw new NotFoundException('Bookmark not found');
    return true;
  }

  // Highlights
  async listHighlights(userId: string, bookId: string) {
    return this.prisma.highlight.findMany({
      where: { userId, bookId },
      orderBy: { page: 'asc' },
    });
  }

  async addHighlight(userId: string, input: AddHighlightInput) {
    return this.prisma.highlight.create({
      data: { userId, ...input },
    });
  }

  async removeHighlight(id: string, userId: string) {
    const result = await this.prisma.highlight.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) throw new NotFoundException('Highlight not found');
    return true;
  }

  async deleteBook(id: string, actorId: string, actorRole: UserRole) {
    await this.assertCanManageBookPublic(id, actorId, actorRole);
    return this.prisma.book.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async assertCanManageBookPublic(
    bookId: string,
    actorId: string,
    actorRole: UserRole,
  ) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException('Book not found');

    const isOwner = book.createdById === actorId;
    const isStaff = actorRole === UserRole.ADMIN || actorRole === UserRole.MODERATOR;
    if (!isOwner && !isStaff) {
      throw new ForbiddenException('You do not have permission to modify this book');
    }
  }
}
