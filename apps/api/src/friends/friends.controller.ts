import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { FriendsService } from './friends.service';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { FriendshipStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard)
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.friendsService.list(user);
  }

  @Post('request')
  sendRequest(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFriendRequestDto,
  ) {
    return this.friendsService.sendRequest(user, dto.addresseeId);
  }

  @Post(':id/accept')
  accept(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.friendsService.respond(user, id, FriendshipStatus.accepted);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.friendsService.respond(user, id, FriendshipStatus.rejected);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.friendsService.remove(user, id);
  }

  @Get('search')
  search(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.friendsService.search(user, q ?? '');
  }
}
