import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { BooksService } from './books.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import {
  Book, BookProgress, Bookmark, Highlight,
  UploadBookInput, UpdateBookInput, SaveProgressInput,
  AddBookmarkInput, AddHighlightInput,
} from './models/book.model.js';
import { GraphQLUpload, FileUpload } from 'graphql-upload-ts';

@Resolver()
export class BooksResolver {
  constructor(private readonly booksService: BooksService) {}

  @Query(() => [Book], { name: 'books' })
  @UseGuards(JwtAuthGuard)
  async books() {
    return this.booksService.listBooks();
  }

  @Query(() => Book, { name: 'book' })
  @UseGuards(JwtAuthGuard)
  async book(@Args('id') id: string) {
    return this.booksService.findById(id);
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
    @Args('id') id: string,
    @Args('input') input: UpdateBookInput,
  ) {
    return this.booksService.updateBook(id, input);
  }

  @Mutation(() => Book, { name: 'uploadPdf' })
  @UseGuards(JwtAuthGuard)
  async uploadPdf(
    @Args('bookId') bookId: string,
    @Args('file', { type: () => GraphQLUpload }) file: FileUpload,
  ) {
    const { createReadStream, filename } = await file;
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      createReadStream().on('data', (chunk) => chunks.push(chunk));
      createReadStream().on('end', () => resolve(Buffer.concat(chunks)));
      createReadStream().on('error', reject);
    });
    return this.booksService.uploadPdf(bookId, buffer, filename);
  }

  @Mutation(() => Boolean, { name: 'deleteBook' })
  @UseGuards(JwtAuthGuard)
  async deleteBook(@Args('id') id: string) {
    await this.booksService.deleteBook(id);
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
  async removeBookmark(@Args('id') id: string) {
    await this.booksService.removeBookmark(id);
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
  async removeHighlight(@Args('id') id: string) {
    await this.booksService.removeHighlight(id);
    return true;
  }
}
