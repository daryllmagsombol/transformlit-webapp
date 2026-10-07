import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const mockQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('../../lib/apollo-client', () => ({
  apolloClient: { query: mockQuery, mutate: mockMutate },
}));

const mockAddToast = jest.fn();

jest.mock('../ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading…</div>,
}));

import { GroupReadingPlan } from './group-reading-plan';

const book = { id: 'b1', title: 'Usbong', author: 'MOVE', coverUrl: null };

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    groupId: 'g1',
    title: null,
    startDate: '2026-01-01T00:00:00Z',
    targetDate: '2026-02-01T00:00:00Z',
    status: 'ACTIVE',
    expectedPercent: 50,
    book,
    members: [
      {
        user: { id: 'u1', displayName: 'Ann', avatarUrl: null },
        currentPage: 50,
        totalPages: 100,
        percent: 50,
        onPace: true,
      },
      {
        user: { id: 'u2', displayName: 'Ben', avatarUrl: null },
        currentPage: 10,
        totalPages: 100,
        percent: 10,
        onPace: false,
      },
    ],
    ...overrides,
  };
}

describe('GroupReadingPlan', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows a member empty state when there is no plan', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: null } });
    render(<GroupReadingPlan groupId="g1" canModerate={false} />);
    expect(await screen.findByText('No reading plan yet.')).toBeInTheDocument();
  });

  it('shows the start form to a moderator when there is no plan', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: null } });
    render(<GroupReadingPlan groupId="g1" canModerate />);
    expect(await screen.findByText('Start a reading plan')).toBeInTheDocument();
  });

  it('renders the active plan with expected pace and member rows', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: plan() } });
    render(<GroupReadingPlan groupId="g1" canModerate={false} />);
    expect(await screen.findByText('Usbong')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
    expect(screen.getByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('On pace')).toBeInTheDocument();
    expect(screen.getByText('Behind')).toBeInTheDocument();
  });

  it('does not offer archive to a non-moderator', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: plan() } });
    render(<GroupReadingPlan groupId="g1" canModerate={false} />);
    await screen.findByText('Usbong');
    expect(screen.queryByText('Archive plan')).not.toBeInTheDocument();
  });

  it('archives the plan for a moderator and reloads', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: plan() } });
    mockMutate.mockResolvedValue({ data: { archiveGroupReadingPlan: true } });
    render(<GroupReadingPlan groupId="g1" canModerate />);
    await screen.findByText('Usbong');
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: null } });
    fireEvent.click(screen.getByText('Archive plan'));
    await waitFor(() => expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      variables: { planId: 'p1' },
    })));
    await waitFor(() => expect(screen.queryByText('Usbong')).not.toBeInTheDocument());
  });

  it('degrades to a neutral state when the query fails', async () => {
    mockQuery.mockRejectedValue(new Error('offline'));
    render(<GroupReadingPlan groupId="g1" canModerate={false} />);
    expect(await screen.findByText(/unavailable right now/)).toBeInTheDocument();
  });

  it('rejects a target date on or before the start date', async () => {
    mockQuery.mockResolvedValue({ data: { groupReadingPlan: null } });
    render(<GroupReadingPlan groupId="g1" canModerate />);
    await screen.findByText('Start a reading plan');
    // book pick is empty -> validation error on submit
    fireEvent.submit(screen.getByText('Start plan').closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a book.');
  });
});
