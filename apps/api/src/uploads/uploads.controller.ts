import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { UploadsService } from './uploads.service.js';

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file field is required');
    if (!ALLOWED_MIMETYPES.includes(file.mimetype)) {
      throw new BadRequestException('Only jpeg, png, webp and gif images are allowed');
    }
    const key = await this.uploads.saveImage(file.buffer, file.mimetype);
    return { key };
  }

  @Get(':key')
  async serve(@Param('key') key: string, @Res() res: Response) {
    // Serve only keys whose extension we can map to a known image type. This
    // stops the route from ever streaming an arbitrary local file should a key
    // resolve oddly, even though resolveLocalPath already basenames and
    // rejects URL-style keys.
    const ext = this.uploads.extOf(key);
    const contentType = CONTENT_TYPE_BY_EXT[ext];
    if (!contentType) throw new NotFoundException();
    if (!this.uploads.localFileExists(key)) throw new NotFoundException();
    res.type(contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Keys are UUID-addressed and content-addressed in practice, so the files
    // are immutable and safe to cache for a year in shared/public caches.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    createReadStream(this.uploads.resolveLocalPath(key)!).pipe(res);
  }
}
