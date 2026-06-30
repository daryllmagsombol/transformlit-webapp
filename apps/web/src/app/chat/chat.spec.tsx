import { render, screen } from '@testing-library/react';

jest.mock('../../components/layout/authenticated-layout', () => ({
  AuthenticatedLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="authenticated-layout">{children}</div>
  ),
}));

import ChatPage from './chat-client';

describe('ChatPage', () => {
  it('renders the Chat heading', () => {
    render(<ChatPage />);
    expect(screen.getByText('Chat')).toBeInTheDocument();
  });

  it('renders the coming soon message', () => {
    render(<ChatPage />);
    expect(screen.getByText('Real-time chat coming soon.')).toBeInTheDocument();
  });

  it('renders inside the authenticated layout', () => {
    render(<ChatPage />);
    expect(screen.getByTestId('authenticated-layout')).toBeInTheDocument();
  });
});
