import { render, screen } from '@testing-library/react';

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
});
