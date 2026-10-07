import { gql, type TypedDocumentNode } from '@apollo/client';
import { apolloClient } from './apollo-client';
import type {
  GraphQLBook,
  GraphQLGroup,
  GraphQLGroupHighlight,
  GraphQLGroupReadingPlan,
} from '@transformlit/shared';

/**
 * Group reading plans + shared highlights. Mirrors the inline-`gql` convention
 * used by the sibling `groups.ts` lib (and the `groups.graphql` operations).
 */

export const GROUP_READING_PLAN_QUERY: TypedDocumentNode<
  { groupReadingPlan: GraphQLGroupReadingPlan | null },
  { groupId: string }
> = gql`
  query GroupReadingPlan($groupId: String!) {
    groupReadingPlan(groupId: $groupId) {
      id
      groupId
      title
      startDate
      targetDate
      status
      expectedPercent
      book {
        id
        title
        author
        coverUrl
      }
      members {
        currentPage
        totalPages
        percent
        onPace
        user {
          id
          displayName
          avatarUrl
        }
      }
    }
  }
`;

export const GROUP_HIGHLIGHTS_QUERY: TypedDocumentNode<
  { groupHighlights: GraphQLGroupHighlight[] },
  { groupId: string; offset?: number; limit?: number }
> = gql`
  query GroupHighlights($groupId: String!, $offset: Int, $limit: Int) {
    groupHighlights(groupId: $groupId, offset: $offset, limit: $limit) {
      id
      createdAt
      sharedBy {
        id
        displayName
        avatarUrl
      }
      highlight {
        id
        bookId
        page
        text
        note
        color
        bookTitle
      }
    }
  }
`;

export const CREATE_GROUP_READING_PLAN_MUTATION: TypedDocumentNode<
  { createGroupReadingPlan: GraphQLGroupReadingPlan },
  { input: { groupId: string; bookId: string; title?: string | null; startDate: string; targetDate: string } }
> = gql`
  mutation CreateGroupReadingPlan($input: CreateGroupReadingPlanInput!) {
    createGroupReadingPlan(input: $input) {
      id
      groupId
      title
      startDate
      targetDate
      status
      expectedPercent
    }
  }
`;

export const ARCHIVE_GROUP_READING_PLAN_MUTATION: TypedDocumentNode<
  { archiveGroupReadingPlan: boolean },
  { planId: string }
> = gql`
  mutation ArchiveGroupReadingPlan($planId: String!) {
    archiveGroupReadingPlan(planId: $planId)
  }
`;

export const SHARE_HIGHLIGHT_TO_GROUP_MUTATION: TypedDocumentNode<
  { shareHighlightToGroup: GraphQLGroupHighlight },
  { input: { groupId: string; highlightId: string } }
> = gql`
  mutation ShareHighlightToGroup($input: ShareHighlightInput!) {
    shareHighlightToGroup(input: $input) {
      id
      createdAt
      sharedBy {
        id
        displayName
        avatarUrl
      }
      highlight {
        id
        page
        text
        note
        color
        bookTitle
      }
    }
  }
`;

export const UNSHARE_HIGHLIGHT_MUTATION: TypedDocumentNode<
  { unshareHighlight: boolean },
  { shareId: string }
> = gql`
  mutation UnshareHighlight($shareId: String!) {
    unshareHighlight(shareId: $shareId)
  }
`;

/** Loads the group's ACTIVE reading plan (or null) with derived pacing. */
export async function fetchGroupReadingPlan(
  groupId: string,
): Promise<GraphQLGroupReadingPlan | null> {
  const { data } = await apolloClient.query({
    query: GROUP_READING_PLAN_QUERY,
    variables: { groupId },
    fetchPolicy: 'network-only',
  });
  return data?.groupReadingPlan ?? null;
}

/** Loads a page of shared highlights, newest first. */
export async function fetchGroupHighlights(
  groupId: string,
  offset = 0,
  limit = 25,
): Promise<GraphQLGroupHighlight[]> {
  const { data } = await apolloClient.query({
    query: GROUP_HIGHLIGHTS_QUERY,
    variables: { groupId, offset, limit },
    fetchPolicy: 'network-only',
  });
  return data?.groupHighlights ?? [];
}

/** The caller's ACTIVE groups — used as the share-to-group target picker. */
export const MY_GROUPS_QUERY: TypedDocumentNode<{ myGroups: GraphQLGroup[] }> = gql`
  query MyGroupsForSharing {
    myGroups {
      id
      name
      slug
    }
  }
`;

/** Loads the caller's ACTIVE groups for the share picker. */
export async function fetchMyGroups(): Promise<GraphQLGroup[]> {
  const { data } = await apolloClient.query({
    query: MY_GROUPS_QUERY,
    fetchPolicy: 'network-only',
  });
  return data?.myGroups ?? [];
}

/** Catalog books, for the plan's book picker. */
export const BOOKS_FOR_PLAN_QUERY: TypedDocumentNode<{ books: GraphQLBook[] }> = gql`
  query BooksForPlan {
    books {
      id
      title
      author
      coverUrl
    }
  }
`;

/** Loads the book catalog for the plan picker. */
export async function fetchBooksForPlan(): Promise<GraphQLBook[]> {
  const { data } = await apolloClient.query({
    query: BOOKS_FOR_PLAN_QUERY,
    fetchPolicy: 'network-only',
  });
  return data?.books ?? [];
}
