import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { AddAccessDto } from './dto/add-access.dto';

@UseGuards(JwtAuthGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.documentsService.list(user);
  }

  @Get(':id')
  getById(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documentsService.getById(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(user, dto as any);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(user, id, dto as any);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documentsService.remove(user, id);
  }

  @Post(':id/access')
  addAccess(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddAccessDto,
  ) {
    return this.documentsService.addAccess(user, id, dto as any);
  }

  @Delete(':id/access/:accessId')
  removeAccess(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('accessId') accessId: string,
  ) {
    return this.documentsService.removeAccess(user, id, accessId);
  }
}
