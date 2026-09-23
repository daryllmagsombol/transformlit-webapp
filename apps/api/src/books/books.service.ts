import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MAX_FILE_SIZE_BYTES, UserRole } from '@transformlit/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlobService } from '../azure/blob.service.js';
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
    await this.assertCanManageBook(bookId, actorId, actorRole);

    if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('File exceeds maximum allowed size');
    }
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new BadRequestException('Uploaded file is not a PDF');
    }

    // Never trust the client-supplied filename; always generate a server-side path.
    const blobPath = `books/${bookId}/${randomUUID()}.pdf`;
    await this.blob.uploadPdf(blobPath, buffer, 'application/pdf');
    return this.prisma.book.update({
      where: { id: bookId },
      data: { blobPath, status: 'PUBLISHED', publishedAt: new Date() },
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
