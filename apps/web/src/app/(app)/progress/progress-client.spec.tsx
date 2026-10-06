import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import {
  MyActivityCalendarDocument,
  MyProgressDocument,
  SetReadingGoalDocument,
} from '@transformlit/graphql';

const THIS_YEAR = new Date().getFullYear();

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/progress',
}));

let mockAuthState: Record<string, unknown> = {
  user: { id: '1', displayName: 'Test User', avatarUrl: null },
  isHydrated: true,
};

jest.mock('../../../store', () => ({
  useAuthStore: (selector: (s: Record<string, unknown>) => unknown) => selector(mockAuthState),
}));

const mockQuery = jest.fn();
const mockMutate = jest.fn();

jest.mock('../../../lib/apollo-client', () => ({
  apolloClient: {
    query: (...args: unknown[]) => mockQuery(...args),
    mutate: (...args: unknown[]) => mockMutate(...args),
  },
}));

const mockRecordActivity = jest.fn();

jest.mock('../../../lib/progress/record-activity', () => ({
  recordActivity: (...args: unknown[]) =>
    Promise.resolve(mockRecordActivity(...args)).catch(() => undefined),
}));

const mockAddToast = jest.fn();

jest.mock('../../../components/ui', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  LoadingSpinner: ({ showLabel = true }: { showLabel?: boolean }) => (
    <div data-testid="loading-spinner">{showLabel && 'Loading…'}</div>
  ),
}));

interface PointFixture {
  dayKey: string;
  activityCount: number;
  pagesRead: number;
}

let calendarFixture: PointFixture[];

function makeProgress(year: number) {
  return {
    year,
    goal: null,
    daysRead: 12,
    pagesRead: 240,
    currentStreak: 5,
    longestStreak: 14,
    lastActiveDayKey: `${year}-10-06`,
  };
}

function makeCalendar(year: number): PointFixture[] {
  return [0, 1, 2, 3, 4].map((count, offset) => ({
    dayKey: `${year}-01-0${offset + 1}`,
    activityCount: count,
    pagesRead: count * 10,
  }));
}

function mockQueryByDocument() {
  mockQuery.mockImplementation(
    ({ query, variables }: { query: unknown; variables: { year: number } }) => {
      if (query === MyProgressDocument) {
        return Promise.resolve({ data: { myProgress: makeProgress(variables.year) } });
      }
      if (query === MyActivityCalendarDocument) {
        return Promise.resolve({
          data: { myActivityCalendar: makeCalendar(variables.year) },
        });
      }
      return Promise.resolve({ data: {} });
    },
  );
}

import ProgressClient from './progress-client';

describe('ProgressClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockClear();
    mockAddToast.mockClear();
    mockQuery.mockReset();
    mockMutate.mockReset();
    mockRecordActivity.mockReset();
    calendarFixture = makeCalendar(THIS_YEAR);
    mockAuthState = {
      user: { id: '1', displayName: 'Test User', avatarUrl: null },
      isHydrated: true,
    };
    mockMutate.mockResolvedValue({
      data: {
        setReadingGoal: { year: THIS_YEAR, targetKind: 'DAYS', targetValue: 24 },
      },
    });
    mockQueryByDocument();
  });

  describe('auth guard', () => {
    it('shows a loading spinner before auth hydrates', () => {
      mockAuthState = { user: { id: '1' }, isHydrated: false };
      render(<ProgressClient />);
      expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    });

    it('redirects to login when hydrated without a user', () => {
      mockAuthState = { user: null, isHydrated: true };
      render(<ProgressClient />);
      expect(mockPush).toHaveBeenCalledWith('/login?redirect=%2Fprogress');
    });
  });

  describe('streak header', () => {
    it('renders current streak, longest streak, and last active day from mocked data', async () => {
      render(<ProgressClient />);

      await waitFor(() => {
        expect(screen.getByTestId('current-streak')).toHaveTextContent('5');
      });

      expect(screen.getByTestId('longest-streak')).toHaveTextContent('14');
      expect(screen.getByTestId('last-active')).toHaveAttribute(
        'data-day-key',
        `${THIS_YEAR}-10-06`,
      );
    });

    it('shows a quiet fallback when the progress query fails', async () => {
      mockQuery.mockImplementation(({ query }: { query: unknown }) => {
        if (query === MyProgressDocument) return Promise.reject(new Error('offline'));
        return Promise.resolve({
          data: { myActivityCalendar: makeCalendar(THIS_YEAR) },
        });
      });

      render(<ProgressClient />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t load/i);
      });
      // The heatmap still renders despite the header failure.
      expect(screen.getAllByTestId('heatmap-cell').length).toBeGreaterThan(0);
    });
  });

  describe('heatmap calendar', () => {
    it('renders exactly one cell per calendar point', async () => {
      render(<ProgressClient />);

      await waitFor(() => {
        expect(screen.getAllByTestId('heatmap-cell')).toHaveLength(calendarFixture.length);
      });
    });

    it('shades each cell by its activityCount intensity on a 0-4 scale', async () => {
      render(<ProgressClient />);

      await waitFor(() => {
        expect(screen.getAllByTestId('heatmap-cell')).toHaveLength(calendarFixture.length);
      });

      const cells = screen.getAllByTestId('heatmap-cell');
      calendarFixture.forEach((point, offset) => {
        expect(cells[offset]).toHaveAttribute('data-day-key', point.dayKey);
        expect(cells[offset]).toHaveAttribute('data-intensity', String(point.activityCount));
      });
    });

    it('renders a graceful empty state when no activity exists for the year', async () => {
      mockQuery.mockImplementation(({ query, variables }: { query: unknown; variables: { year: number } }) => {
        if (query === MyProgressDocument) {
          return Promise.resolve({ data: { myProgress: makeProgress(variables.year) } });
        }
        return Promise.resolve({ data: { myActivityCalendar: [] } });
      });

      render(<ProgressClient />);

      await waitFor(() => {
        expect(screen.getByText(new RegExp(`no reading recorded in ${THIS_YEAR}`, 'i'))).toBeInTheDocument();
      });
      expect(screen.queryAllByTestId('heatmap-cell')).toHaveLength(0);
    });
  });

  describe('goal editor', () => {
    it('rejects an out-of-range DAYS goal without calling the mutation', async () => {
      render(<ProgressClient />);

      const input = await screen.findByLabelText(/goal target/i);
      fireEvent.change(input, { target: { value: '400' } });
      fireEvent.click(screen.getByRole('button', { name: /save goal/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/366/);
      });
      expect(mockMutate).not.toHaveBeenCalled();
    });

    it('saves a valid DAYS goal through SetReadingGoal', async () => {
      render(<ProgressClient />);

      const input = await screen.findByLabelText(/goal target/i);
      fireEvent.change(input, { target: { value: '200' } });
      fireEvent.click(screen.getByRole('button', { name: /save goal/i }));

      await waitFor(() => {
        expect(mockMutate).toHaveBeenCalledWith(
          expect.objectContaining({
            mutation: SetReadingGoalDocument,
            variables: {
              input: { year: THIS_YEAR, targetKind: 'DAYS', targetValue: 200 },
            },
          }),
        );
      });
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/saved/i), 'success');
    });

    it('surfaces an error when the mutation rejects', async () => {
      mockMutate.mockRejectedValueOnce(new Error('offline'));

      render(<ProgressClient />);

      const input = await screen.findByLabelText(/goal target/i);
      fireEvent.change(input, { target: { value: '120' } });
      fireEvent.click(screen.getByRole('button', { name: /save goal/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(/could not save/i);
      });
      expect(mockAddToast).toHaveBeenCalledWith(expect.stringMatching(/could not save/i), 'error');
    });
  });

  describe('year switcher', () => {
    it('re-queries both progress and calendar for the previous year', async () => {
      render(<ProgressClient />);

      await waitFor(() => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query: MyProgressDocument,
            variables: { year: THIS_YEAR },
          }),
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /previous year/i }));

      await waitFor(() => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query: MyProgressDocument,
            variables: { year: THIS_YEAR - 1 },
          }),
        );
      });
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: MyActivityCalendarDocument,
          variables: { year: THIS_YEAR - 1 },
        }),
      );
    });
  });

  describe('manual check-in', () => {
    it('records a reading activity and refreshes the page', async () => {
      render(<ProgressClient />);

      const button = await screen.findByRole('button', { name: /log today.s reading/i });
      fireEvent.click(button);

      expect(mockRecordActivity).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'BOOK_READ' }),
      );

      // The page re-queries both datasets after a check-in.
      await waitFor(() => {
        expect(mockQuery).toHaveBeenCalledWith(
          expect.objectContaining({
            query: MyActivityCalendarDocument,
            variables: { year: THIS_YEAR },
          }),
        );
      });
    });
  });
});
