import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
  Int,
} from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GroupsService } from './groups.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Group, GroupMember, CreateGroupInput, UpdateGroupInput } from './models/group.model.js';
import { GroupCategory } from '@transformlit/shared';

@Resolver(() => Group)
export class GroupsResolver {
  constructor(private readonly groupsService: GroupsService) {}

  // ── Field Resolvers ────────────────────────────────────────────────────────

  @ResolveField(() => Int)
  async memberCount(@Parent() group: Group) {
    // If the service already computed it, use it; otherwise count fresh
    if ((group as any).memberCount != null) return (group as any).memberCount;
    return this.groupsService.countActiveMembers(group.id);
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  @Query(() => [Group], { name: 'groups' })
  @UseGuards(JwtAuthGuard)
  async groups(@CurrentUser() user: { id: string }) {
    return this.groupsService.listGroups(user.id);
  }

  @Query(() => [Group], { name: 'myGroups' })
  @UseGuards(JwtAuthGuard)
  async myGroups(@CurrentUser() user: { id: string }) {
    return this.groupsService.myGroups(user.id);
  }

  @Query(() => [Group], { name: 'discoverGroups' })
  @UseGuards(JwtAuthGuard)
  async discoverGroups(
    @CurrentUser() user: { id: string },
    @Args('category', { type: () => GroupCategory, nullable: true }) category?: GroupCategory,
  ) {
    return this.groupsService.discoverGroups(user.id, category);
  }

  @Query(() => Group, { name: 'group', nullable: true })
  @UseGuards(JwtAuthGuard)
  async group(@Args('id') id: string, @CurrentUser() user: { id: string }) {
    return this.groupsService.findById(id, user.id);
  }

  @Query(() => Group, { name: 'groupBySlug', nullable: true })
  @UseGuards(JwtAuthGuard)
  async groupBySlug(
    @Args('slug') slug: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.groupsService.findBySlug(slug, user.id);
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

  // ── Mutations ──────────────────────────────────────────────────────────────

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
