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
    if (!this.uploads.localFileExists(key)) throw new NotFoundException();
    const ext = this.uploads.extOf(key);
    res.type(CONTENT_TYPE_BY_EXT[ext] ?? 'application/octet-stream');
    createReadStream(this.uploads.resolveLocalPath(key)!).pipe(res);
  }
}
