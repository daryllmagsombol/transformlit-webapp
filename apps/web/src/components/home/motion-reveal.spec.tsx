import { render, screen } from '@testing-library/react';

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
(global as unknown as { IntersectionObserver: unknown }).IntersectionObserver = MockIntersectionObserver;

(global as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

import { Reveal } from './motion-reveal';

describe('Reveal', () => {
  it('renders its children', () => {
    render(<Reveal>Hello Reveal</Reveal>);
    expect(screen.getByText('Hello Reveal')).toBeInTheDocument();
  });

  it('accepts a className', () => {
    render(
      <Reveal className="test-class">
        <span>Content</span>
      </Reveal>,
    );
    expect(document.querySelector('.test-class')).toBeInTheDocument();
  });
});