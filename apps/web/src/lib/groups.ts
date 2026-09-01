import { gql } from '@apollo/client';
import { apolloClient } from './apollo-client';
import { API_BASE } from './constants';
import { useAuthStore } from '../store';
import type { GraphQLGroup } from '@transformlit/shared';

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
