import { render, screen } from '@testing-library/react';

jest.mock('../../components/layout/authenticated-layout', () => ({
  AuthenticatedLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="authenticated-layout">{children}</div>
  ),
}));

import FriendsPage from './friends-client';

describe('FriendsPage', () => {
  it('renders the Friends heading', () => {
    render(<FriendsPage />);
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('renders the coming soon message', () => {
    render(<FriendsPage />);
    expect(screen.getByText('Friend management coming soon.')).toBeInTheDocument();
  });

  it('renders inside the authenticated layout', () => {
    render(<FriendsPage />);
    expect(screen.getByTestId('authenticated-layout')).toBeInTheDocument();
  });
});
