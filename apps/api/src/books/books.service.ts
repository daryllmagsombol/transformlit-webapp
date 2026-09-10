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
import { ConversionJobService } from './conversion/conversion-job.service.js';
import {
  UploadBookInput,
  UpdateBookInput,
  SaveProgressInput,
  AddBookmarkInput,
  AddHighlightInput,
} from './models/book.model.js';

@Injectable()
export class BooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly conversionJobs: ConversionJobService,
  ) {}

  async listBooks() {
    return this.prisma.book.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, userId?: string) {
    const book = await this.prisma.book.findUnique({ where: { id, deletedAt: null } });
    if (!book) throw new NotFoundException('Book not found');
    return book;
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
    await this.assertCanManageBook(id, actorId, actorRole);
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
    await this.assertCanManageBook(bookId, actorId, actorRole);

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

    const book = await this.prisma.book.update({
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
    await this.conversionJobs.enqueue(bookId);
    return book;
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
   * Single entitlement gate for every reader request. Throws rather than
   * returning booleans so callers cannot accidentally ignore the result.
   */
  async assertCanRead(bookId: string, userId: string) {
    const book = await this.prisma.book.findUnique({ where: { id: bookId } });
    if (!book || book.deletedAt) throw new NotFoundException('Book not available');
    if (book.status !== 'PUBLISHED') throw new ForbiddenException('Book is not published');
    if (book.conversionStatus !== 'READY') throw new ForbiddenException('Book is not ready to read');

    const hasAccess =
      book.accessLevel === 'FREE' ||
      book.createdById === userId ||
      (await this.prisma.bookAccess.findUnique({ where: { bookId_userId: { bookId, userId } } })) !== null;
    if (!hasAccess) throw new ForbiddenException('You do not have access to this book');
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
    await this.assertCanManageBook(id, actorId, actorRole);
    return this.prisma.book.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private async assertCanManageBook(
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
