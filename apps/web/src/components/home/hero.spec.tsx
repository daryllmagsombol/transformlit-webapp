import { render, screen } from '@testing-library/react';

jest.mock('next/link', () => {
  return function MockLink({ children, href, className }: Record<string, unknown>) {
    return <a href={href as string} className={className as string}>{children}</a>;
  };
});

import { Hero } from './hero';

describe('Hero', () => {
  it('renders headline, tagline eyebrow and sub-copy', () => {
    render(<Hero />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Raising transformed followers');
    expect(screen.getByText('Turning Pages, Turning Hearts.')).toBeInTheDocument();
  });

  it('renders both CTAs with correct anchors', () => {
    render(<Hero />);
    const partner = screen.getByText('Partner With Us');
    const move = screen.getByText('Explore the MOVE System');
    expect(partner).toHaveAttribute('href', '#partner-with-us');
    expect(move).toHaveAttribute('href', '#move-system');
  });
});