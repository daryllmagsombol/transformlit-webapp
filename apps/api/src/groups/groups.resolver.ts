import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Group, GroupMember, CreateGroupInput, UpdateGroupInput } from './models/group.model.js';

@Resolver()
export class GroupsResolver {
  constructor(private readonly groupsService: GroupsService) {}

  @Query(() => [Group], { name: 'groups' })
  @UseGuards(JwtAuthGuard)
  async groups(@CurrentUser() user: { id: string }) {
    return this.groupsService.listGroups(user.id);
  }

  @Query(() => Group, { name: 'group', nullable: true })
  @UseGuards(JwtAuthGuard)
  async group(@Args('id') id: string, @CurrentUser() user: { id: string }) {
    return this.groupsService.findById(id, user.id);
  }

  @Query(() => [Group], { name: 'searchGroups' })
  @UseGuards(JwtAuthGuard)
  async searchGroups(@Args('query') query: string) {
    return this.groupsService.searchGroups(query);
  }

  @Query(() => [GroupMember], { name: 'groupMembers' })
  @UseGuards(JwtAuthGuard)
  async groupMembers(@Args('groupId') groupId: string) {
    return this.groupsService.listMembers(groupId);
  }

  @Mutation(() => Group, { name: 'createGroup' })
  @UseGuards(JwtAuthGuard)
  async createGroup(
    @CurrentUser() user: { id: string },
    @Args('input') input: CreateGroupInput,
  ) {
    return this.groupsService.create(user.id, input);
  }

  @Mutation(() => GroupMember, { name: 'joinGroup' })
  @UseGuards(JwtAuthGuard)
  async joinGroup(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
  ) {
    return this.groupsService.join(groupId, user.id);
  }

  @Mutation(() => Boolean, { name: 'leaveGroup' })
  @UseGuards(JwtAuthGuard)
  async leaveGroup(
    @CurrentUser() user: { id: string },
    @Args('groupId') groupId: string,
  ) {
    return this.groupsService.leave(groupId, user.id);
  }

  @Mutation(() => Group, { name: 'updateGroup' })
  @UseGuards(JwtAuthGuard)
  async updateGroup(
    @Args('groupId') groupId: string,
    @Args('input') input: UpdateGroupInput,
  ) {
    return this.groupsService.updateGroup(groupId, input);
  }

  @Mutation(() => Group, { name: 'deleteGroup' })
  @UseGuards(JwtAuthGuard)
  async deleteGroup(@Args('groupId') groupId: string) {
    return this.groupsService.deleteGroup(groupId);
  }
}
