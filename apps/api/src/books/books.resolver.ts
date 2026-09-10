import { Resolver, Query, Mutation, Args, ResolveField, Parent } from '@nestjs/graphql';
import { UseGuards, BadRequestException } from '@nestjs/common';
import { MAX_FILE_SIZE_BYTES, UserRole } from '@transformlit/shared';
import { BooksService, ReadableBookFacts } from './books.service.js';
import { ConversionJobService } from './conversion/conversion-job.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  Book, BookProgress, Bookmark, Highlight, BookTocEntry,
  UploadBookInput, UpdateBookInput, SaveProgressInput,
  AddBookmarkInput, AddHighlightInput,
} from './models/book.model.js';
import { GraphQLUpload, FileUpload } from 'graphql-upload-ts';

@Resolver(() => Book)
export class BooksResolver {
  constructor(
    private readonly booksService: BooksService,
    private readonly conversionJobs: ConversionJobService,
  ) {}

  @Query(() => [Book], { name: 'books' })
  @UseGuards(JwtAuthGuard)
  async books() {
    return this.booksService.listBooks();
  }

  @Query(() => Book, { name: 'book' })
  @UseGuards(JwtAuthGuard)
  async book(@CurrentUser() user: { id: string }, @Args('id') id: string) {
    await this.booksService.assertCanRead(id, user.id);
    return this.booksService.findById(id);
  }

  @Query(() => [BookTocEntry], { name: 'bookToc' })
  @UseGuards(JwtAuthGuard)
  async bookToc(@CurrentUser() user: { id: string }, @Args('bookId') bookId: string) {
    // Same entitlement/published/READY/soft-delete gate as page delivery.
    await this.booksService.assertCanRead(bookId, user.id);
    return this.booksService.listToc(bookId);
  }

  /**
   * Resolves ToC on every Book path. The `books` list is intentionally not
   * filtered by status/entitlement (store browse), so this gate — not the list
   * query — is what prevents DRAFT/RESTRICTED ToC leakage to a plain member.
   */
  @ResolveField(() => [BookTocEntry], { name: 'toc' })
  async toc(
    @Parent() book: ReadableBookFacts & { toc?: BookTocEntry[] },
    @CurrentUser() user: { id: string },
  ) {
    if (!(await this.booksService.canRead(book, user.id))) return [];
    if (book.toc) return book.toc;
    return this.booksService.listToc(book.id);
  }

  @Mutation(() => Book, { name: 'retryBookConversion' })
  @UseGuards(JwtAuthGuard)
  async retryBookConversion(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('bookId') bookId: string,
  ) {
    await this.booksService.assertCanManageBookPublic(bookId, user.id, user.role);
    await this.booksService.setConversionPending(bookId);
    await this.conversionJobs.enqueue(bookId);
    return this.booksService.findById(bookId);
  }

  @Mutation(() => Book, { name: 'uploadBook' })
  @UseGuards(JwtAuthGuard)
  async uploadBook(
    @CurrentUser() user: { id: string },
    @Args('input') input: UploadBookInput,
  ) {
    return this.booksService.uploadBook(input, user.id);
  }

  @Mutation(() => Book, { name: 'updateBook' })
  @UseGuards(JwtAuthGuard)
  async updateBook(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
    @Args('input') input: UpdateBookInput,
  ) {
    return this.booksService.updateBook(id, input, user.id, user.role);
  }

  @Mutation(() => Book, { name: 'uploadPdf' })
  @UseGuards(JwtAuthGuard)
  async uploadPdf(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('bookId') bookId: string,
    @Args('file', { type: () => GraphQLUpload }) file: FileUpload,
  ) {
    const { createReadStream } = file;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const stream = createReadStream();
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_FILE_SIZE_BYTES) {
          stream.destroy();
          reject(new BadRequestException('File exceeds maximum allowed size'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
    return this.booksService.uploadPdf(bookId, buffer, '', user.id, user.role);
  }

  @Mutation(() => Boolean, { name: 'deleteBook' })
  @UseGuards(JwtAuthGuard)
  async deleteBook(
    @CurrentUser() user: { id: string; role: UserRole },
    @Args('id') id: string,
  ) {
    await this.booksService.deleteBook(id, user.id, user.role);
    return true;
  }

  @Query(() => BookProgress, { name: 'readProgress', nullable: true })
  @UseGuards(JwtAuthGuard)
  async readProgress(
    @CurrentUser() user: { id: string },
    @Args('bookId') bookId: string,
  ) {
    return this.booksService.getProgress(user.id, bookId);
  }

  @Mutation(() => BookProgress, { name: 'saveProgress' })
  @UseGuards(JwtAuthGuard)
  async saveProgress(
    @CurrentUser() user: { id: string },
    @Args('input') input: SaveProgressInput,
  ) {
    return this.booksService.saveProgress(user.id, input);
  }

  @Query(() => [Bookmark], { name: 'bookmarks' })
  @UseGuards(JwtAuthGuard)
  async bookmarks(
    @CurrentUser() user: { id: string },
    @Args('bookId') bookId: string,
  ) {
    return this.booksService.listBookmarks(user.id, bookId);
  }

  @Mutation(() => Bookmark, { name: 'addBookmark' })
  @UseGuards(JwtAuthGuard)
  async addBookmark(
    @CurrentUser() user: { id: string },
    @Args('input') input: AddBookmarkInput,
  ) {
    return this.booksService.addBookmark(user.id, input);
  }

  @Mutation(() => Boolean, { name: 'removeBookmark' })
  @UseGuards(JwtAuthGuard)
  async removeBookmark(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
  ) {
    await this.booksService.removeBookmark(id, user.id);
    return true;
  }

  @Query(() => [Highlight], { name: 'highlights' })
  @UseGuards(JwtAuthGuard)
  async highlights(
    @CurrentUser() user: { id: string },
    @Args('bookId') bookId: string,
  ) {
    return this.booksService.listHighlights(user.id, bookId);
  }

  @Mutation(() => Highlight, { name: 'addHighlight' })
  @UseGuards(JwtAuthGuard)
  async addHighlight(
    @CurrentUser() user: { id: string },
    @Args('input') input: AddHighlightInput,
  ) {
    return this.booksService.addHighlight(user.id, input);
  }

  @Mutation(() => Boolean, { name: 'removeHighlight' })
  @UseGuards(JwtAuthGuard)
  async removeHighlight(
    @CurrentUser() user: { id: string },
    @Args('id') id: string,
  ) {
    await this.booksService.removeHighlight(id, user.id);
    return true;
  }
}
