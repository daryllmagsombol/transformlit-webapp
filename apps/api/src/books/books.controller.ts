import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
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
import { BookDownloadService } from './book-download.service.js';
import { STORAGE_ADAPTER, StorageAdapter } from '../storage/storage-adapter.js';

interface AuthedRequest extends Request {
  user: { id: string; role: string };
}

/** Page routes allow ~90 page fetches per minute per client. */
const PAGE_RATE_LIMIT = { default: { limit: 90, ttl: 60000 } };

/**
 * Whole-book download routes get a separate, bounded budget so a download
 * cannot exhaust the reading-session/page budget (and vice versa). Download
 * traffic is version-pinned and analytics-free, so it is throttled on its own
 * named bucket rather than the shared `default` bucket.
 */
const DOWNLOAD_RATE_LIMIT = { download: { limit: 30, ttl: 60000 } };

@Controller('books')
export class BooksController {
  private readonly logger = new Logger(BooksController.name);

  constructor(
    private readonly books: BooksService,
    private readonly sessions: ReaderSessionService,
    @Inject(STORAGE_ADAPTER) private readonly storage: StorageAdapter,
    private readonly pageViews: PageViewService,
    private readonly downloads: BookDownloadService,
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
    // Browser-session cookie: the server slides `expiresAt`, so a fixed
    // `maxAge` here would expire the cookie before the session does.
    // `path` must be `/`: deployed behind nginx the page routes are served under
    // `/api/books/...`, so a `/books` cookie would never be sent with the frame
    // and text requests, leaving every page read unauthenticated (401).
    res.cookie(READER_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
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
    const { book, session } = await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.assetKey) throw new NotFoundException('Page not found');

    const buffer = await this.storage.getBuffer(record.assetKey);
    if (!buffer) throw new NotFoundException('Page asset missing');

    // Analytics is best-effort: a recording failure must never break (or delay)
    // a legitimate page read. Only the frame marks a page turn.
    this.pageViews
      .record(session, page, book.contentVersion)
      .catch((error: Error) =>
        this.logger.warn(`Failed to record page view for book ${bookId} page ${page}: ${error.message}`),
      );

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
  async getText(
    @Param('id') bookId: string,
    @Param('n', ParseIntPipe) page: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authorizePage(bookId, page, req);
    const record = await this.books.getPageRecord(bookId, page);
    if (!record?.textKey) throw new NotFoundException('Page text not found');
    const buffer = await this.storage.getBuffer(record.textKey);
    if (!buffer) throw new NotFoundException('Page text missing');

    // Match the frame endpoint: page text is session-scoped and must never be
    // cached by URL alone (`Vary: Cookie` keeps shared/CDN caches honest).
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Cookie');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return JSON.parse(buffer.toString()) as { items: Array<{ t: string; x: number; y: number; w: number; h: number }> };
  }

  /**
   * Version-pinned offline manifest. Bearer-authenticated and gated by the
   * current book-access check — never a reading-session cookie. Privately
   * delivered so the browser only persists it on an explicit download action.
   */
  @Get(':id/offline-manifest')
  @UseGuards(AuthGuard('jwt'), ThrottlerGuard)
  @Throttle(DOWNLOAD_RATE_LIMIT)
  async getOfflineManifest(
    @Param('id') bookId: string,
    @Query('contentVersion', new ParseIntPipe({ optional: true })) contentVersion: number | undefined,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.setDownloadHeaders(res);
    return this.downloads.getManifest(bookId, req.user.id, contentVersion);
  }

  /**
   * Contract endpoint: the exact immutable bytes for a version-pinned asset
   * id from the manifest. Storage keys never appear in a URL or response.
   */
  @Get(':id/content/:version/assets/:assetId')
  @UseGuards(AuthGuard('jwt'), ThrottlerGuard)
  @Throttle(DOWNLOAD_RATE_LIMIT)
  async getOfflineAsset(
    @Param('id') bookId: string,
    @Param('version', ParseIntPipe) version: number,
    @Param('assetId') assetId: string,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const asset = await this.downloads.getAssetById(bookId, req.user.id, version, assetId);
    this.sendDownloadAsset(res, asset);
  }

  /** Convenience frame route pinned to a content version. */
  @Get(':id/offline/:version/pages/:n/frame')
  @UseGuards(AuthGuard('jwt'), ThrottlerGuard)
  @Throttle(DOWNLOAD_RATE_LIMIT)
  async getOfflineFrame(
    @Param('id') bookId: string,
    @Param('version', ParseIntPipe) version: number,
    @Param('n', ParseIntPipe) page: number,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const asset = await this.downloads.getAsset(bookId, req.user.id, version, page, 'frame');
    this.sendDownloadAsset(res, asset);
  }

  /** Convenience text-layer route pinned to a content version. */
  @Get(':id/offline/:version/pages/:n/text')
  @UseGuards(AuthGuard('jwt'), ThrottlerGuard)
  @Throttle(DOWNLOAD_RATE_LIMIT)
  async getOfflineText(
    @Param('id') bookId: string,
    @Param('version', ParseIntPipe) version: number,
    @Param('n', ParseIntPipe) page: number,
    @Req() req: AuthedRequest,
    @Res() res: Response,
  ) {
    const asset = await this.downloads.getAsset(bookId, req.user.id, version, page, 'text');
    this.sendDownloadAsset(res, asset);
  }

  /** Private, analytics-free delivery shared by every download response. */
  private setDownloadHeaders(res: Response): void {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Vary', 'Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
  }

  private sendDownloadAsset(
    res: Response,
    asset: { buffer: Buffer; mediaType: string; byteLength: number; sha256: string },
  ): void {
    this.setDownloadHeaders(res);
    res.setHeader('Content-Length', asset.byteLength);
    res.setHeader('ETag', `"sha256-${asset.sha256}"`);
    res.type(asset.mediaType);
    res.send(asset.buffer);
  }

  /** Session cookie must be live AND belong to this book; entitlement is re-checked. */
  private async authorizePage(bookId: string, page: number, req: Request) {
    const token = (req.cookies as Record<string, string> | undefined)?.[READER_COOKIE_NAME];
    const session = await this.sessions.resolve(token ?? '');
    if (session?.bookId !== bookId) {
      throw new UnauthorizedException('Reading session is missing or expired');
    }
    const book = await this.books.assertCanRead(bookId, session.userId);
    if (!book.pageCount || page < 1 || page > book.pageCount) throw new NotFoundException('Page out of range');
    return { book, session };
  }
}
