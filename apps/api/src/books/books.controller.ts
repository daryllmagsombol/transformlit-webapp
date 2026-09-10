import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { BooksService } from './books.service.js';
import { ReaderSessionService, READER_COOKIE_NAME, READER_SESSION_TTL_MS } from './reader-session.service.js';
import { PageViewService } from './page-view.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';

interface AuthedRequest extends Request {
  user: { id: string; role: string };
}

/** Page routes allow ~90 page fetches per minute per client. */
const PAGE_RATE_LIMIT = { default: { limit: 90, ttl: 60000 } };

@Controller('books')
export class BooksController {
  constructor(
    private readonly books: BooksService,
    private readonly sessions: ReaderSessionService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly pageViews: PageViewService,
  ) {}

  /** Bearer-authed. Sets the scoped, httpOnly reading-session cookie. */
  @Post(':id/reading-session')
  @UseGuards(AuthGuard('jwt'))
  async createSession(
    @Param('id') bookId: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.books.assertCanRead(bookId, req.user.id);
    const token = await this.sessions.create(req.user.id, bookId);
    res.cookie(READER_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/books',
      maxAge: READER_SESSION_TTL_MS,
    });
    return { expiresInMs: READER_SESSION_TTL_MS };
  }

  @Get(':id/pages/:n/frame')
  @UseGuards(ThrottlerGuard)
  @Throttle(PAGE_RATE_LIMIT)
  async getFrame(
    @Param('id') bookId: string,
    @Param('n', ParseIntPipe) page: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.assetKey) throw new NotFoundException('Page not found');

    const buffer = await this.storage.getBuffer(record.assetKey);
    if (!buffer) throw new NotFoundException('Page asset missing');

    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.type(record.mimeType ?? 'image/png');
    res.send(buffer);
  }

  @Get(':id/pages/:n/text')
  @UseGuards(ThrottlerGuard)
  @Throttle(PAGE_RATE_LIMIT)
  async getText(@Param('id') bookId: string, @Param('n', ParseIntPipe) page: number, @Req() req: Request) {
    await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.textKey) throw new NotFoundException('Page text not found');
    const buffer = await this.storage.getBuffer(record.textKey);
    if (!buffer) throw new NotFoundException('Page text missing');
    return JSON.parse(buffer.toString()) as { items: Array<{ t: string; x: number; y: number; w: number; h: number }> };
  }

  /** Session cookie must be live AND belong to this book; entitlement is re-checked. */
  private async authorizePage(bookId: string, page: number, req: Request) {
    const token = (req.cookies as Record<string, string> | undefined)?.[READER_COOKIE_NAME];
    const session = await this.sessions.resolve(token ?? '');
    if (!session || session.bookId !== bookId) {
      throw new UnauthorizedException('Reading session is missing or expired');
    }
    const book = await this.books.assertCanRead(bookId, session.userId);
    if (!book.pageCount || page < 1 || page > book.pageCount) throw new NotFoundException('Page out of range');
    await this.pageViews.record(session, page, book.contentVersion);
    return book;
  }
}
