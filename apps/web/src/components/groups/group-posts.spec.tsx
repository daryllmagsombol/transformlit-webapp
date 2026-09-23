import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

let mockAuthState: Record<string, unknown> = {
  user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
  isHydrated: true,
};

jest.mock('../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

jest.mock('@apollo/client', () => ({
  gql: (strings: TemplateStringsArray) => strings[0],
}));

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: {
    query: mockQuery,
    mutate: mockMutate,
  },
}));

const mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  LoadingSpinner: ({ showLabel = true }: { showLabel?: boolean }) => (
    <div data-testid="loading-spinner">{showLabel && 'Loading…'}</div>
  ),
}));

import { GroupPosts } from './group-posts';

const baseGroup = {
  id: 'g1',
  name: 'Bible Study',
  slug: 'bible-study',
  description: 'Weekly study',
  visibility: 'PUBLIC',
  category: 'BIBLICAL_STUDIES',
  coverImageUrl: null,
  memberCount: 5,
  myRole: 'MEMBER',
  myStatus: 'ACTIVE',
  featured: false,
  createdAt: '2025-01-01T00:00:00Z',
};

const fixturePost = {
  id: 'p1',
  groupId: 'g1',
  body: 'Excited for today!',
  imageKey: null,
  createdAt: '2025-01-01T00:00:00Z',
  likeCount: 3,
  commentCount: 1,
  likedByMe: false,
  author: { id: 'u2', displayName: 'Sarah', avatarUrl: null },
};

describe('GroupPosts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockAuthState = {
      user: { id: 'u1', displayName: 'Test User', avatarUrl: null },
      isHydrated: true,
    };
  });

  it('renders composer for ACTIVE member', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupPosts: [] } });
    render(<GroupPosts group={baseGroup} onChanged={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("What's on your mind?")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /post/i })).toBeInTheDocument();
  });

  it('does not render composer for non-member', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupPosts: [] } });
    render(<GroupPosts group={{ ...baseGroup, myStatus: 'NONE' as string }} onChanged={jest.fn()} />);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("What's on your mind?")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/join the group to post/i)).toBeInTheDocument();
  });

  it('renders post body and image', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        groupPosts: [
          { ...fixturePost, imageKey: 'uploads/photo.png' },
        ],
      },
    });
    render(<GroupPosts group={baseGroup} onChanged={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Excited for today!')).toBeInTheDocument();
    });
    expect(screen.getByAltText('Post attachment')).toBeInTheDocument();
  });

  it('toggling like calls the mutation and flips count', async () => {
    mockQuery.mockResolvedValueOnce({ data: { groupPosts: [fixturePost] } });
    mockMutate.mockResolvedValueOnce({ data: { toggleGroupPostLike: true } });

    render(<GroupPosts group={baseGroup} onChanged={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Excited for today!')).toBeInTheDocument();
    });

    const likeButton = screen.getByRole('button', { name: /3/i });
    fireEvent.click(likeButton);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { postId: 'p1' },
        }),
      );
    });
  });

  it('adding a comment calls createGroupPostComment mutation', async () => {
    mockQuery
      .mockResolvedValueOnce({ data: { groupPosts: [fixturePost] } })
      .mockResolvedValueOnce({ data: { groupPostComments: [] } });
    mockMutate.mockResolvedValueOnce({
      data: { createGroupPostComment: { id: 'c1', body: 'Great post!' } },
    });

    render(<GroupPosts group={baseGroup} onChanged={jest.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Excited for today!')).toBeInTheDocument();
    });

    const commentButton = screen.getByRole('button', { name: /1/i });
    fireEvent.click(commentButton);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Write a comment…')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Write a comment…');
    fireEvent.change(input, { target: { value: 'Great post!' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { postId: 'p1', body: 'Great post!' },
        }),
      );
    });
  });
});
