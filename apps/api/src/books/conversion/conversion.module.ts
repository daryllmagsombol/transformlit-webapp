import { Module } from '@nestjs/common';
import { ConversionJobService } from './conversion-job.service.js';
import { ConversionRunner } from './conversion.runner.js';
import { PdfConverter } from './pdf.converter.js';

@Module({
  providers: [ConversionJobService, PdfConverter, ConversionRunner],
  exports: [ConversionJobService, ConversionRunner],
})
export class ConversionModule {}
