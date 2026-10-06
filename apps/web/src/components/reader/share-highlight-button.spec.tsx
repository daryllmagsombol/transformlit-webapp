import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: mockQuery, mutate: mockMutate },
}));

const mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

import { ShareHighlightButton } from './share-highlight-button';

describe('ShareHighlightButton', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a pending state when the highlight has no server id', () => {
    render(<ShareHighlightButton highlightServerId={null} highlightLabel="quote" />);
    expect(screen.getByText('Share pending sync')).toBeInTheDocument();
  });

  it('lists the caller\'s groups and shares to the chosen one', async () => {
    mockQuery.mockResolvedValue({ data: { myGroups: [{ id: 'g1', name: 'Bible Study', slug: 'bible' }] } });
    mockMutate.mockResolvedValue({ data: { shareHighlightToGroup: { id: 's1' } } });
    render(<ShareHighlightButton highlightServerId="hl-1" highlightLabel="quote" />);
    fireEvent.click(screen.getByText('Share to group'));
    fireEvent.click(await screen.findByText('Bible Study'));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      variables: { input: { groupId: 'g1', highlightId: 'hl-1' } },
    })));
    expect(mockAddToast).toHaveBeenCalledWith('Shared to group.', 'success');
  });

  it('toasts on a failed share', async () => {
    mockQuery.mockResolvedValue({ data: { myGroups: [{ id: 'g1', name: 'Bible Study', slug: 'bible' }] } });
    mockMutate.mockRejectedValue(new Error('offline'));
    render(<ShareHighlightButton highlightServerId="hl-1" highlightLabel="quote" />);
    fireEvent.click(screen.getByText('Share to group'));
    fireEvent.click(await screen.findByText('Bible Study'));
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Failed to share highlight.', 'error'));
  });

  it('shows an empty state when the caller has no groups', async () => {
    mockQuery.mockResolvedValue({ data: { myGroups: [] } });
    render(<ShareHighlightButton highlightServerId="hl-1" highlightLabel="quote" />);
    fireEvent.click(screen.getByText('Share to group'));
    expect(await screen.findByText('No groups to share to.')).toBeInTheDocument();
  });
});
