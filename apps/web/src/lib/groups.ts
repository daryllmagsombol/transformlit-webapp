import { gql } from '@apollo/client';
import { apolloClient } from './apollo-client';
import { API_BASE } from './constants';
import { useAuthStore } from '../store';
import type { GraphQLGroup, GraphQLGroupPost, GraphQLGroupPostComment } from '@transformlit/shared';

export const GROUP_BY_SLUG_QUERY = gql`
  query GroupBySlug($slug: String!) {
    groupBySlug(slug: $slug) {
      id
      name
      slug
      description
      visibility
      category
      coverImageUrl
      memberCount
      myRole
      myStatus
    }
  }
`;

export const JOIN_GROUP_MUTATION = gql`
  mutation JoinGroup($groupId: ID!) {
    joinGroup(groupId: $groupId) {
      id
      status
    }
  }
`;

export const LEAVE_GROUP_MUTATION = gql`
  mutation LeaveGroup($groupId: ID!) {
    leaveGroup(groupId: $groupId)
  }
`;

export async function fetchGroupBySlug(slug: string): Promise<GraphQLGroup | null> {
  const { data } = await apolloClient.query<{ groupBySlug: GraphQLGroup | null }>({
    query: GROUP_BY_SLUG_QUERY,
    variables: { slug },
    fetchPolicy: 'network-only',
  });
  return data?.groupBySlug ?? null;
}

/** Resolve a stored image key to a displayable URL */
export function resolveImageUrl(key?: string | null): string | undefined {
  if (!key) return undefined;
  if (key.startsWith('http')) return key;
  return `${API_BASE}/${key}`;
}

/** Upload an image via the REST endpoint; returns the storage key */
export async function uploadImage(file: File): Promise<string> {
  const token = useAuthStore.getState().token;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  if (!res.ok) throw new Error('Upload failed');
  const { key } = (await res.json()) as { key: string };
  return key;
}

export const GROUP_POSTS_QUERY = gql`
  query GroupPosts($groupId: ID!, $offset: Int!, $limit: Int!) {
    groupPosts(groupId: $groupId, offset: $offset, limit: $limit) {
      id
      body
      imageKey
      createdAt
      likeCount
      commentCount
      likedByMe
      author { id displayName avatarUrl }
    }
  }
`;

export const GROUP_POST_COMMENTS_QUERY = gql`
  query GroupPostComments($postId: ID!) {
    groupPostComments(postId: $postId) {
      id
      body
      createdAt
      author { id displayName avatarUrl }
    }
  }
`;

export const CREATE_GROUP_POST_MUTATION = gql`
  mutation CreateGroupPost($groupId: ID!, $input: CreateGroupPostInput!) {
    createGroupPost(groupId: $groupId, input: $input) {
      id
      body
      imageKey
      createdAt
      likeCount
      commentCount
      likedByMe
      author { id displayName avatarUrl }
    }
  }
`;

export const DELETE_GROUP_POST_MUTATION = gql`
  mutation DeleteGroupPost($postId: ID!) {
    deleteGroupPost(postId: $postId)
  }
`;

export const TOGGLE_GROUP_POST_LIKE_MUTATION = gql`
  mutation ToggleGroupPostLike($postId: ID!) {
    toggleGroupPostLike(postId: $postId)
  }
`;

export const CREATE_GROUP_POST_COMMENT_MUTATION = gql`
  mutation CreateGroupPostComment($postId: ID!, $body: String!) {
    createGroupPostComment(postId: $postId, body: $body) {
      id
      body
      createdAt
      author { id displayName avatarUrl }
    }
  }
`;

export const DELETE_GROUP_POST_COMMENT_MUTATION = gql`
  mutation DeleteGroupPostComment($commentId: ID!) {
    deleteGroupPostComment(commentId: $commentId)
  }
`;

export async function fetchGroupPosts(groupId: string, offset = 0, limit = 20): Promise<GraphQLGroupPost[]> {
  const { data } = await apolloClient.query<{ groupPosts: GraphQLGroupPost[] }>({
    query: GROUP_POSTS_QUERY,
    variables: { groupId, offset, limit },
    fetchPolicy: 'network-only',
  });
  return data?.groupPosts ?? [];
}

export async function fetchGroupPostComments(postId: string): Promise<GraphQLGroupPostComment[]> {
  const { data } = await apolloClient.query<{ groupPostComments: GraphQLGroupPostComment[] }>({
    query: GROUP_POST_COMMENTS_QUERY,
    variables: { postId },
    fetchPolicy: 'network-only',
  });
  return data?.groupPostComments ?? [];
}

export async function createGroupPost(groupId: string, body: string, imageKey?: string): Promise<GraphQLGroupPost> {
  const { data } = await apolloClient.mutate<{ createGroupPost: GraphQLGroupPost }>({
    mutation: CREATE_GROUP_POST_MUTATION,
    variables: { groupId, input: { body, imageKey } },
  });
  if (!data?.createGroupPost) throw new Error('Failed to create post');
  return data.createGroupPost;
}

export async function deleteGroupPost(postId: string): Promise<boolean> {
  const { data } = await apolloClient.mutate<{ deleteGroupPost: boolean }>({
    mutation: DELETE_GROUP_POST_MUTATION,
    variables: { postId },
  });
  return data?.deleteGroupPost ?? false;
}

export async function toggleGroupPostLike(postId: string): Promise<boolean> {
  const { data } = await apolloClient.mutate<{ toggleGroupPostLike: boolean }>({
    mutation: TOGGLE_GROUP_POST_LIKE_MUTATION,
    variables: { postId },
  });
  return data?.toggleGroupPostLike ?? false;
}

export async function createGroupPostComment(postId: string, body: string): Promise<GraphQLGroupPostComment> {
  const { data } = await apolloClient.mutate<{ createGroupPostComment: GraphQLGroupPostComment }>({
    mutation: CREATE_GROUP_POST_COMMENT_MUTATION,
    variables: { postId, body },
  });
  if (!data?.createGroupPostComment) throw new Error('Failed to create comment');
  return data.createGroupPostComment;
}

export async function deleteGroupPostComment(commentId: string): Promise<boolean> {
  const { data } = await apolloClient.mutate<{ deleteGroupPostComment: boolean }>({
    mutation: DELETE_GROUP_POST_COMMENT_MUTATION,
    variables: { commentId },
  });
  return data?.deleteGroupPostComment ?? false;
}
